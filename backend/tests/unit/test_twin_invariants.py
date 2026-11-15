"""Season-level invariants of the twin on synthetic and real inputs (testing-strategy.md)."""

from __future__ import annotations

from datetime import date

import pytest

from app.engine import twin
from app.engine.monte_carlo import run_monte_carlo
from app.providers.factory import Providers
from app.schemas.common import DataState, IrrigationLevel, PhenoStage
from app.schemas.twin import TwinScenario
from tests.conftest import provider_sets


def _inputs(p: Providers, zone_index: int = 0, year: int = 2024) -> twin.SeasonInputs:
    farm = p.farm.get_farm("story_pilot_farm")
    zone = farm.zones[zone_index]
    crop = p.catalog.get_catalog().get(zone.crop_id)
    assert crop is not None
    days = p.weather.get_daily(date(year, 3, 1), date(year, 11, 30)).days
    return twin.SeasonInputs(
        days=days,
        soil=zone.soil,
        crop=crop,
        planting_date=date(year, 5, 5),
        lat=zone.centroid.lat,
        elevation_m=300.0,
        irrigation_level=IrrigationLevel.NONE,
    )


@pytest.fixture(params=provider_sets(), ids=lambda p: p.mode)
def inputs(request: pytest.FixtureRequest) -> twin.SeasonInputs:
    return _inputs(request.param)


def test_state_bounds_and_monotonic_gdd(inputs: twin.SeasonInputs) -> None:
    states = twin.run_season(inputs)
    assert len(states) == len(inputs.days)
    for s in states:
        assert 0.0 <= s.root_zone_depletion_mm <= s.taw_mm + 1e-6
        assert 0.0 <= s.ks <= 1.0
        assert s.et0_mm >= 0.0
    gdd = [s.gdd_cum for s in states]
    planted = [g for s, g in zip(states, gdd, strict=True) if s.stage is not PhenoStage.PRE_PLANTING]
    assert all(b >= a for a, b in zip(planted, planted[1:], strict=False))


def test_season_mass_balance(inputs: twin.SeasonInputs) -> None:
    states = twin.run_season(inputs)
    # Over the season, change of stored water = inputs - outputs; root growth adds TAW (new layer at FC)
    for prev, cur in zip(states, states[1:], strict=False):
        start = min(prev.root_zone_depletion_mm, cur.taw_mm)
        delta = cur.root_zone_depletion_mm - start
        rhs = cur.etc_adj_mm - cur.effective_precip_mm - cur.irrigation_mm + cur.drainage_mm
        # Rounding to 3 decimals in TwinState bounds the residual
        assert delta == pytest.approx(rhs, abs=5e-3)


def test_stage_sequence(inputs: twin.SeasonInputs) -> None:
    order = list(PhenoStage)
    seen = [s.stage for s in twin.run_season(inputs)]
    idx = [order.index(st) for st in seen]
    assert idx == sorted(idx)


def test_neutral_fork_equals_run_season(inputs: twin.SeasonInputs) -> None:
    base = twin.run_season(inputs)
    neutral = TwinScenario()
    assert twin.fork(None, inputs, neutral) == base
    anchor = base[len(base) // 2]
    assert twin.fork(anchor, inputs, neutral) == base


def test_fork_keeps_history_and_marks_future_simulated(inputs: twin.SeasonInputs) -> None:
    base = twin.run_season(inputs)
    anchor = base[100]
    forked = twin.fork(anchor, inputs, TwinScenario(precip_factor=0.5, temp_delta_c=2.0))
    assert forked[:101] == base[:101]
    if inputs.output_state is not DataState.SYNTHETIC:
        assert all(s.data_state is DataState.SIMULATED for s in forked[101:])


def test_less_rain_never_increases_mean_ks(inputs: twin.SeasonInputs) -> None:
    def mean_ks(factor: float) -> float:
        states = twin.fork(None, inputs, TwinScenario(precip_factor=factor))
        return twin.summarise(states, inputs.crop, inputs.planting_date).mean_ks

    values = [mean_ks(f) for f in (1.2, 1.0, 0.7, 0.4)]
    assert all(b <= a + 1e-9 for a, b in zip(values, values[1:], strict=False))


def test_irrigation_scenario_reduces_stress(inputs: twin.SeasonInputs) -> None:
    dry = twin.fork(None, inputs, TwinScenario(precip_factor=0.4))
    irrigated = twin.fork(None, inputs, TwinScenario(precip_factor=0.4, irrigation_level=IrrigationLevel.HIGH))
    s_dry = twin.summarise(dry, inputs.crop, inputs.planting_date)
    s_irr = twin.summarise(irrigated, inputs.crop, inputs.planting_date)
    assert s_irr.total_irrigation_mm > 0
    assert s_irr.mean_ks >= s_dry.mean_ks


def test_determinism_and_monte_carlo(inputs: twin.SeasonInputs) -> None:
    assert twin.run_season(inputs) == twin.run_season(inputs)
    a = run_monte_carlo(inputs, 12, seed=7)
    b = run_monte_carlo(inputs, 12, seed=7)
    assert a == b
    assert a.mean_ks_p10 <= a.mean_ks_p50 <= a.mean_ks_p90


def test_season_outcome_from_stages_only(inputs: twin.SeasonInputs) -> None:
    states = twin.run_season(inputs)
    summary = twin.summarise(states, inputs.crop, inputs.planting_date)
    outcome = twin.season_outcome(states, inputs.crop, inputs.planting_date, summary)
    harvested = any(s.stage is PhenoStage.HARVESTED for s in states)
    assert outcome.reached_maturity is harvested
    assert outcome.status == ("COMPLETED" if harvested else "NOT_MATURE")
    assert outcome.planted_in_window is True
    assert outcome.stress_days == summary.stress_days
    assert outcome.data_state in (DataState.SIMULATED, DataState.SYNTHETIC)
    assert "yield" in outcome.note

    # Cut the window before maturity: the crop is planted but heat runs out
    short = [s for s in states if s.stage is not PhenoStage.HARVESTED][:120]
    cut = twin.season_outcome(short, inputs.crop, inputs.planting_date, summary)
    assert cut.status == "NOT_MATURE" and cut.maturity_date is None
    assert cut.gdd_accumulated < cut.gdd_required

    bare = [s for s in states if s.stage is PhenoStage.PRE_PLANTING]
    none = twin.season_outcome(bare, inputs.crop, inputs.planting_date, summary)
    assert none.status == "NOT_PLANTED" and none.stress_days == 0 and not none.planted_in_window
