"""Historical analogue simulations must never be presented as future observations."""

from datetime import date

from fastapi.testclient import TestClient

from app.config import DEFAULT_DERIVED_DIR
from app.main import create_app
from app.providers.real.weather import RealWeatherProvider
from app.schemas.common import DataState
from app.services.weather_reference import analogue_weather, observed_coverage


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

    from app.services.errors import InvalidRequestError

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
    with pytest.raises(InvalidRequestError, match="2024-01-02"):
        analogue_weather(incomplete, date(2027, 1, 1), date(2027, 1, 3), 2024)


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
