"""CMIP6 projection climate: unit conversion, gap filling, calendar quirks, model range and failure modes.

No network: a trimmed real response (tests/fixtures) and a generated one with the same JSON shape.
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.deps import providers_dep
from app.main import create_app
from app.providers.factory import Providers
from app.providers.live.projection import (
    DAILY_MODELS,
    FILLED_FLAG,
    WIND_10M_TO_2M,
    ProjectionProvider,
    parse_projection,
)
from app.schemas.common import DataState, TwinLevel
from app.schemas.twin import ProjectionRequest, TwinSimulateRequest
from app.services import twin_service
from app.services.errors import InvalidRequestError

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "power_projection_gfdl_esm4_ssp245_trim.json"


def _fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _raw(data: dict[str, object], param: str, key: str) -> float:
    return float(data["properties"]["parameter"][param]["ssp245"][key])  # type: ignore[index]


# ─────────────────────────────────────────
# Section: Parsing a recorded response
# ─────────────────────────────────────────


def test_radiation_and_wind_are_converted():
    data = _fixture()
    series, _, in_w_m2 = parse_projection(data, "ssp245", date(2026, 12, 1), date(2026, 12, 10))
    day = series.days[4]
    assert in_w_m2
    assert day.solar_rad == pytest.approx(_raw(data, "ALLSKY_SFC_SW_DWN", "20261205") * 0.0864)
    # FAO-56 eq. 47 at 10 m
    assert WIND_10M_TO_2M == pytest.approx(4.87 / math.log(672.58))
    assert day.wind_2m == pytest.approx(_raw(data, "WS10M", "20261205") * WIND_10M_TO_2M)
    assert day.t_max == _raw(data, "T2M_MAX", "20261205")
    assert series.provenance.data_state == DataState.SIMULATED
    assert "0.0864" in (series.provenance.method or "")
    assert series.elevation_m == pytest.approx(1006.91)


def test_mj_sized_radiation_is_not_converted_twice():
    data = _fixture()
    block = data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]["ssp245"]  # type: ignore[index]
    for k, v in block.items():
        block[k] = v if v == -999 else round(v * 0.0864, 2)
    series, _, in_w_m2 = parse_projection(data, "ssp245", date(2026, 12, 1), date(2026, 12, 10))
    assert not in_w_m2
    assert series.days[4].solar_rad == pytest.approx(_raw(data, "ALLSKY_SFC_SW_DWN", "20261205"))


def test_late_december_gap_is_filled_from_the_same_model_and_flagged():
    data = _fixture()
    # The real response lacks 2026-12-20..31 (12 days, longer than the 3-day interpolation)
    assert _raw(data, "T2M", "20261225") == -999
    series, gaps, _ = parse_projection(data, "ssp245", date(2026, 12, 1), date(2027, 1, 15))
    assert gaps == [(date(2026, 12, 20), date(2026, 12, 31))]
    filled = [d for d in series.days if FILLED_FLAG in d.qa_flags]
    assert [d.date for d in filled] == [date(2026, 12, 20) + timedelta(days=i) for i in range(12)]
    assert len(series.days) == 46
    window = [d for d in series.days if FILLED_FLAG not in d.qa_flags and abs((d.date - date(2026, 12, 25)).days) < 25]
    lo, hi = min(d.t_mean for d in window), max(d.t_mean for d in window)
    assert all(lo <= d.t_mean <= hi for d in filled)
    assert all(d.precip >= 0 for d in series.days)


def test_february_29_of_a_365_day_model_is_interpolated():
    data = _fixture()
    assert _raw(data, "T2M", "20280229") == -999
    series, gaps, _ = parse_projection(data, "ssp245", date(2028, 2, 25), date(2028, 3, 3))
    assert gaps == [(date(2028, 2, 29), date(2028, 2, 29))]
    feb29 = next(d for d in series.days if d.date == date(2028, 2, 29))
    assert FILLED_FLAG in feb29.qa_flags
    assert feb29.t_mean == pytest.approx((_raw(data, "T2M", "20280228") + _raw(data, "T2M", "20280301")) / 2)


# ─────────────────────────────────────────
# Section: Service (generated responses, one per model)
# ─────────────────────────────────────────


def _fake_fetcher(calls: list[str], failing: set[str] | None = None, empty: bool = False):
    """Same JSON shape as the API; precipitation scales with the model index so models disagree on rain."""

    def fetch(lat: float, lon: float, model: str, scenario: str, start: date, end: date) -> dict[str, object]:
        calls.append(model)
        if failing and model in failing:
            raise TimeoutError("timed out")
        factor = DAILY_MODELS.index(model) + 1
        params: dict[str, dict[str, dict[str, float]]] = {
            p: {scenario: {}}
            for p in ("T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "RH2M", "ALLSKY_SFC_SW_DWN", "WS10M")
        }
        day = start
        while day <= end:
            k = day.strftime("%Y%m%d")
            missing = (day.month == 12 and day.day >= 20) or (day.month == 2 and day.day == 29)
            doy = day.timetuple().tm_yday
            t = 15.0 + 12.0 * math.sin((doy - 100) / 365 * 2 * math.pi)
            values = {
                "T2M": t,
                "T2M_MAX": t + 6,
                "T2M_MIN": t - 6,
                "PRECTOTCORR": (factor * 2.0) if day.day % 4 == 0 else 0.0,
                "RH2M": 70.0,
                "ALLSKY_SFC_SW_DWN": 220.0,
                "WS10M": 3.0,
            }
            for p, v in values.items():
                params[p][scenario][k] = -999.0 if missing or empty else v
            day += timedelta(days=1)
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat, 300.0]},
            "properties": {"parameter": params},
            "header": {"model": model, "scenarios": [scenario]},
        }

    return fetch


def _with_projection(
    base: Providers, tmp_path: Path, calls: list[str], failing: set[str] | None = None, empty: bool = False
) -> Providers:
    return replace(base, projection=ProjectionProvider(tmp_path, _fake_fetcher(calls, failing, empty)))


BODY = {"farm_id": "story_pilot_farm", "start": "2026-11-01", "end": "2027-10-31", "include_comparison": True}


def test_projection_run_has_range_across_models(synthetic, tmp_path):
    calls: list[str] = []
    p = _with_projection(synthetic, tmp_path, calls)
    req = TwinSimulateRequest.model_validate(
        {**BODY, "climate_source": "projection", "projection": {"scenario": "ssp245"}}
    )
    res = twin_service.simulate(p, req)
    info = res.climate_projection
    assert info is not None
    assert sorted(calls) == sorted(DAILY_MODELS)
    assert info.models_used == sorted(DAILY_MODELS)
    # Median by period rain: rain grows with the model index, so the lower-middle of 4 is the 2nd model
    assert info.animated_model == DAILY_MODELS[1]
    assert res.provenance["weather"].data_state == DataState.SIMULATED
    assert res.provenance["weather"].source.startswith("NASA POWER Climate Projection API")
    assert res.twin_level == TwinLevel.DIGITAL_MODEL
    assert any(r.endswith("2026-12-31") for r in info.filled_days[DAILY_MODELS[0]])
    for zone in res.zones:
        rng = zone.projection_range
        assert rng is not None and rng.n_models == len(DAILY_MODELS)
        assert rng.season_precip_min_mm < rng.season_precip_max_mm
        assert rng.stress_days_min <= zone.outcome.stress_days <= rng.stress_days_max  # type: ignore[union-attr]
        assert not zone.comparison
        assert all(s.data_state == DataState.SIMULATED for s in zone.states)
        # Planted inside the window and progressing beyond the initial stage
        assert BODY["start"] <= zone.planting_date.isoformat() <= BODY["end"]
        assert len({s.stage for s in zone.states}) > 2
    # Cached on disk: a second run does not call the API again
    twin_service.simulate(p, req)
    assert len(calls) == len(DAILY_MODELS)


def test_single_model_and_partial_failure_are_reported(synthetic, tmp_path):
    calls: list[str] = []
    p = _with_projection(synthetic, tmp_path, calls, failing={"ipsl_cm6a_lr", "ec_earth3"})
    res = twin_service.simulate(
        p,
        TwinSimulateRequest.model_validate(
            {**BODY, "climate_source": "projection", "projection": {"scenario": "ssp370"}}
        ),
    )
    assert res.climate_projection is not None
    assert set(res.climate_projection.models_failed) == {"ipsl_cm6a_lr", "ec_earth3"}
    assert any("Respondieron 2 de 4" in w for w in res.warnings)
    one = twin_service.simulate(
        p,
        TwinSimulateRequest.model_validate(
            {**BODY, "climate_source": "projection", "projection": {"scenario": "ssp126", "model": "gfdl_esm4"}}
        ),
    )
    assert one.zones[0].projection_range is not None and one.zones[0].projection_range.n_models == 1
    assert any("Solo se usó un modelo" in w for w in one.warnings)


@pytest.mark.parametrize(
    "extra",
    [
        {"climate_source": "projection", "projection": {"scenario": "ssp245", "model": "ensemble"}},
        {"climate_source": "projection", "projection": {"scenario": "ssp245"}, "reference_year": 2024},
        {"climate_source": "projection"},
        {"projection": {"scenario": "ssp245"}},
        {"climate_source": "reference_year"},
        {"climate_source": "projection", "projection": {"scenario": "ssp245", "model": "miroc6"}},
        # Served by the API but without daily T2M_MAX/T2M_MIN: unusable for GDD and ET0
        {"climate_source": "projection", "projection": {"scenario": "ssp245", "model": "cesm2"}},
        {
            "climate_source": "projection",
            "projection": {"scenario": "ssp245"},
            "start": "2014-04-01",
            "end": "2014-10-31",
        },
    ],
)
def test_invalid_projection_requests_are_422(synthetic, tmp_path, extra):
    p = _with_projection(synthetic, tmp_path, [])
    with pytest.raises(InvalidRequestError):
        twin_service.simulate(p, TwinSimulateRequest.model_validate({**BODY, **extra}))


def test_scenario_outside_the_offer_is_rejected_by_the_schema():
    with pytest.raises(ValueError):
        ProjectionRequest.model_validate({"scenario": "ssp585"})


def test_api_failure_is_503_with_a_spanish_way_out(synthetic, tmp_path):
    p = _with_projection(synthetic, tmp_path, [], failing=set(DAILY_MODELS))
    app = create_app()
    app.dependency_overrides[providers_dep] = lambda: p
    with TestClient(app) as client:
        res = client.post(
            "/api/twin/simulate", json={**BODY, "climate_source": "projection", "projection": {"scenario": "ssp245"}}
        )
    assert res.status_code == 503
    assert "año histórico de referencia" in res.json()["detail"]


def test_request_without_climate_source_behaves_as_before(synthetic):
    body = {"farm_id": "story_pilot_farm", "start": "2024-04-01", "end": "2024-10-31"}
    default = twin_service.simulate(synthetic, TwinSimulateRequest.model_validate(body))
    explicit = twin_service.simulate(synthetic, TwinSimulateRequest.model_validate({**body, "climate_source": None}))
    assert default.climate_projection is None
    assert all(z.projection_range is None for z in default.zones)
    skip = {"computed_at"}
    assert default.model_dump(exclude=skip) == explicit.model_dump(exclude=skip)
    assert not default.provenance["weather"].source.startswith("NASA POWER Climate Projection")


def test_point_without_projection_data_is_422_not_503(synthetic, tmp_path):
    p = _with_projection(synthetic, tmp_path, [], empty=True)
    with pytest.raises(InvalidRequestError, match="no tiene datos para este punto"):
        twin_service.simulate(
            p,
            TwinSimulateRequest.model_validate(
                {**BODY, "climate_source": "projection", "projection": {"scenario": "ssp245"}}
            ),
        )


def test_model_missing_a_variable_is_rejected():
    data = _fixture()
    block = data["properties"]["parameter"]["T2M_MIN"]["ssp245"]  # type: ignore[index]
    for k in block:
        block[k] = -999.0
    with pytest.raises(ValueError, match="T2M_MIN"):
        parse_projection(data, "ssp245", date(2026, 12, 1), date(2026, 12, 10))
