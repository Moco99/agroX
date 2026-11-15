"""Historical analogue simulations must never be presented as future observations."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.config import DEFAULT_DERIVED_DIR
from app.main import create_app
from app.providers.real.weather import RealWeatherProvider
from app.schemas.common import DataState
from app.services.weather_reference import FILLED_FLAG, analogue_weather, observed_coverage


def test_future_twin_and_rotation_use_reference_weather(monkeypatch):
    monkeypatch.setenv("AGROX_DATA_MODE", "real")
    client = TestClient(create_app())
    body = {"farm_id": "story_pilot_farm", "start": "2027-04-01", "end": "2027-10-31"}
    assert client.post("/api/twin/simulate", json={**body, "include_comparison": False}).status_code == 422
    twin = client.post("/api/twin/simulate", json={**body, "reference_year": 2024, "include_comparison": False})
    assert twin.status_code == 200, twin.text
    data = twin.json()
    assert data["provenance"]["weather"]["data_state"] == "SIMULATED"
    assert data["zones"][0]["states"][0]["date"] == body["start"]
    assert all(s["data_state"] == "SIMULATED" for s in data["zones"][0]["states"])
    comparison_twin = client.post(
        "/api/twin/simulate", json={**body, "reference_year": 2024, "include_comparison": True}
    )
    assert comparison_twin.status_code == 200
    for zone in comparison_twin.json()["zones"]:
        assert not zone["comparison"]
        assert zone["ndvi_date"] is None or zone["ndvi_date"] < body["start"]
    assert any("no es un pronóstico" in w for w in data["warnings"])
    rotation = client.post("/api/rotations/recommend", json={**body, "reference_year": 2024})
    assert rotation.status_code == 200, rotation.text
    assert rotation.json()["data_state"] == "SIMULATED"
    assert rotation.json()["inputs"]["reference_year"] == 2024
    assert client.post("/api/rotations/recommend", json={**body, "reference_year": 1990}).status_code == 422


def test_coverage_and_leap_reference():
    provider = RealWeatherProvider(DEFAULT_DERIVED_DIR)
    coverage = observed_coverage(provider)
    assert coverage["start"] <= "2024-02-28" <= coverage["end"]
    source = provider.get_daily(date(2023, 2, 28), date(2023, 2, 28))
    analogue = analogue_weather(provider, date(2028, 2, 28), date(2028, 2, 29), 2023)
    assert [d.date for d in analogue.days] == [date(2028, 2, 28), date(2028, 2, 29)]
    assert analogue.days[1].precip == source.days[0].precip
    assert analogue.provenance.data_state == DataState.SIMULATED
    assert any("29 de febrero" in w for w in analogue.warnings)


def test_year_boundary_and_missing_days_are_explicit():
    import pytest

    provider = RealWeatherProvider(DEFAULT_DERIVED_DIR)
    target = analogue_weather(provider, date(2027, 12, 31), date(2028, 1, 2), 2023)
    source = provider.get_daily(date(2023, 12, 31), date(2024, 1, 2))
    assert [d.precip for d in target.days] == [d.precip for d in source.days]
    assert target.days[1].date == date(2028, 1, 1)

    class MissingDay:
        def coverage(self):
            return date(2024, 1, 1), date(2024, 1, 3)

        def get_daily(self, start, end):
            result = provider.get_daily(start, end)
            return result.model_copy(update={"days": [d for d in result.days if d.date != date(2024, 1, 2)]})

    incomplete = MissingDay()
    assert observed_coverage(incomplete)["missing"] == [{"start": "2024-01-02", "end": "2024-01-02"}]
    filled = analogue_weather(incomplete, date(2027, 1, 1), date(2027, 1, 3), 2024)
    around = provider.get_daily(date(2024, 1, 1), date(2024, 1, 3)).days
    assert filled.days[1].qa_flags == [FILLED_FLAG]
    assert filled.days[1].t_mean == pytest.approx((around[0].t_mean + around[2].t_mean) / 2)
    assert filled.provenance.data_state == DataState.SIMULATED
    assert any("2024-01-02" in w and FILLED_FLAG in w for w in filled.warnings)


class _Gappy:
    """Real 2023-2024 weather with chosen days removed."""

    def __init__(self, missing: set[date]):
        self.inner = RealWeatherProvider(DEFAULT_DERIVED_DIR)
        self.missing = missing

    def coverage(self):
        return self.inner.coverage()

    def get_daily(self, start, end):
        result = self.inner.get_daily(start, end)
        return result.model_copy(update={"days": [d for d in result.days if d.date not in self.missing]})


def test_long_gap_rejects_with_suggestion_and_coverage_lists_complete_years():
    import pytest

    from app.engine.config import REFERENCE_MAX_FILL_DAYS
    from app.services.errors import InvalidRequestError

    gap = {date(2024, 6, 1) + timedelta(days=i) for i in range(REFERENCE_MAX_FILL_DAYS + 1)}
    provider = _Gappy(gap)
    coverage = observed_coverage(provider)
    assert coverage["complete_years"] == [2023]
    assert coverage["latest_complete_year"] == 2023
    with pytest.raises(InvalidRequestError, match="2024-06-01.*por ejemplo 2023"):
        analogue_weather(provider, date(2027, 4, 1), date(2027, 10, 31), 2024)
    # The same reference year is fine when the window does not touch the gap
    assert len(analogue_weather(provider, date(2027, 7, 1), date(2027, 7, 3), 2024).days) == 3


def test_reference_days_after_coverage_wrap_to_previous_year():
    import pytest

    from app.services.errors import InvalidRequestError

    provider = RealWeatherProvider(DEFAULT_DERIVED_DIR)
    # Window crosses a year: the reference advances into 2025, which has no observations yet
    series = analogue_weather(provider, date(2026, 11, 15), date(2027, 11, 15), 2024)
    assert len(series.days) == 366
    source = provider.get_daily(date(2024, 3, 1), date(2024, 3, 1)).days[0]
    assert next(d for d in series.days if d.date == date(2027, 3, 1)).t_mean == source.t_mean
    assert any("año anterior" in w and "2027-01-01" in w for w in series.warnings)
    with pytest.raises(InvalidRequestError, match="aún no tiene observaciones"):
        analogue_weather(provider, date(2026, 11, 15), date(2027, 11, 15), 2025)


def test_synthetic_reference_remains_synthetic():
    from app.providers.synthetic.weather import SyntheticWeatherProvider

    provider = SyntheticWeatherProvider(20261114)
    simulated = analogue_weather(provider, date(2027, 4, 1), date(2027, 4, 7), 2024)
    assert simulated.provenance.data_state == DataState.SYNTHETIC


def test_synthetic_cross_year_with_comparisons_keeps_provenance(monkeypatch):
    monkeypatch.setenv("AGROX_DATA_MODE", "synthetic")
    client = TestClient(create_app())
    body = {"farm_id": "story_pilot_farm", "start": "2026-12-01", "end": "2027-02-28", "reference_year": 2023}
    twin = client.post("/api/twin/simulate", json={**body, "include_comparison": True})
    assert twin.status_code == 200, twin.text
    assert twin.json()["twin_level"] == "DIGITAL_MODEL"
    assert twin.json()["provenance"]["weather"]["data_state"] == "SYNTHETIC"
    assert twin.json()["zones"][0]["states"][0]["data_state"] == "SYNTHETIC"
    rotation = client.post("/api/rotations/recommend", json=body)
    assert rotation.status_code == 200, rotation.text
    assert rotation.json()["data_state"] == "SYNTHETIC"
    coverage = client.get("/api/farms/story_pilot_farm/weather/coverage")
    assert coverage.status_code == 200
    assert coverage.json()["data_state"] == "SYNTHETIC"


def test_coverage_upstream_unavailable_is_503(monkeypatch):
    from app.api import routes
    from app.providers.ports import UpstreamUnavailableError

    class BrokenWeather:
        def coverage(self):
            raise UpstreamUnavailableError("Provider offline")

    monkeypatch.setattr(routes, "weather_for", lambda *_: BrokenWeather())
    response = TestClient(create_app()).get("/api/farms/story_pilot_farm/weather/coverage")
    assert response.status_code == 503


def test_hypothetical_crop_has_simulated_provenance(monkeypatch):
    monkeypatch.setenv("AGROX_DATA_MODE", "real")
    client = TestClient(create_app())
    request = {
        "farm_id": "story_pilot_farm",
        "start": "2024-04-01",
        "end": "2024-10-31",
        "crop_overrides": {"zone_nw": "soybean"},
        "include_comparison": True,
    }
    real = client.post("/api/twin/simulate", json=request)
    assert real.status_code == 200, real.text
    assert real.json()["zones"][0]["crop_state"] == "DECLARED"
    simulated = client.post("/api/twin/simulate", json={**request, "crop_override_state": "SIMULATED"})
    assert simulated.status_code == 200, simulated.text
    body = simulated.json()
    zone = next(z for z in body["zones"] if z["zone_id"] == "zone_nw")
    assert zone["crop_state"] == "SIMULATED"
    assert zone["data_state"] == "SIMULATED"
    assert not zone["comparison"]
    assert body["provenance"]["hypothetical_crop"]["data_state"] == "SIMULATED"
    assert body["twin_level"] == "DIGITAL_MODEL"
    assert client.post("/api/twin/simulate", json={**request, "crop_override_state": "MEASURED"}).status_code == 422


def test_cross_year_twin_plants_in_window_and_reports_outcome(monkeypatch):
    monkeypatch.setenv("AGROX_DATA_MODE", "real")
    client = TestClient(create_app())
    body = {"farm_id": "story_pilot_farm", "start": "2026-11-15", "end": "2027-11-15", "reference_year": 2024}
    response = client.post("/api/twin/simulate", json={**body, "include_comparison": False})
    assert response.status_code == 200, response.text
    for zone in response.json()["zones"]:
        assert body["start"] <= zone["planting_date"] <= body["end"]
        outcome = zone["outcome"]
        assert outcome["data_state"] == "SIMULATED"
        assert outcome["planted_in_window"] is True
        assert "not a yield prediction" in outcome["note"]
