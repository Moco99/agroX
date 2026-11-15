"""Request-contract strictness, crop_overrides, planting suggestion and malformed point ids (no network)."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.providers.factory import Providers
from app.schemas.common import DataState
from app.services import farm_service


def test_unknown_scenario_field_is_rejected(client: TestClient) -> None:
    # The real field is precip_factor: a typo must not silently run the baseline
    r = client.post("/api/twin/simulate", json={"scenario": {"precip_change_pct": -30}})
    assert r.status_code == 422
    assert client.post("/api/twin/simulate", json={"bogus": 1}).status_code == 422
    assert client.post("/api/farms/analyze", json={"farm_id": "story_pilot_farm", "x": 1}).status_code == 422
    assert client.post("/api/twin/simulate", json={"monte_carlo": {"n": 5, "oops": 1}}).status_code == 422


def test_crop_overrides(client: TestClient) -> None:
    base = client.post("/api/twin/simulate", json={"include_states": False}).json()
    zone = base["zones"][0]
    cat = {c["crop_id"] for c in client.get("/api/crops").json()["crops"]}
    other = next(c for c in sorted(cat) if c != zone["crop_id"])
    body = {"include_states": False, "crop_overrides": {zone["zone_id"]: other}}
    ok = client.post("/api/twin/simulate", json=body)
    assert ok.status_code == 200
    z = next(x for x in ok.json()["zones"] if x["zone_id"] == zone["zone_id"])
    assert z["crop_id"] == other and z["crop_state"] == "DECLARED"
    bad_zone = client.post("/api/twin/simulate", json={"crop_overrides": {"zone_nope": other}})
    assert bad_zone.status_code == 404
    bad_crop = client.post("/api/twin/simulate", json={"crop_overrides": {zone["zone_id"]: "not_a_crop"}})
    assert bad_crop.status_code == 422


@pytest.mark.parametrize(("farm_id", "hemisphere"), [("pt_30.8_75.55", "north"), ("pt_-33.9_-60.6", "south")])
def test_planting_suggestion_by_hemisphere(synthetic: Providers, farm_id: str, hemisphere: str) -> None:
    lat = float(farm_id.split("_")[1])
    farm = synthetic.farm.get_farm("story_pilot_farm")
    farm = farm.model_copy(update={"centroid": farm.centroid.model_copy(update={"lat": lat})})
    di = farm_service.declared_inputs(farm, synthetic.catalog.get_catalog(), True, date(2026, 11, 15))
    assert di.hemisphere == hemisphere
    assert di.suggestion_state is DataState.ESTIMATED
    assert "suggestion, verify" in di.note
    assert di.suggested_planting_dates
    for d in di.suggested_planting_dates.values():
        assert di.suggested_season.start <= d <= di.suggested_season.end


@pytest.mark.parametrize("farm_id", ["pt_abc", "pt_95_10", "pt_-70_10"])
def test_malformed_point_ids_are_client_errors(client: TestClient, farm_id: str) -> None:
    assert client.get(f"/api/farms/{farm_id}").status_code == 422
    assert client.post("/api/twin/simulate", json={"farm_id": farm_id}).status_code == 422
    assert client.get(f"/api/farms/{farm_id}/status").status_code in (404, 422)
    assert client.get("/api/twin/state", params={"farm_id": farm_id}).status_code in (404, 422)
    assert client.get("/api/observations/ndvi", params={"farm_id": farm_id}).status_code in (404, 422)


def test_point_farm_needs_live_mode(client: TestClient) -> None:
    # Fixture modes are real/synthetic: a valid point id must explain that live mode is required
    r = client.get("/api/farms/pt_30.8_75.55")
    assert r.status_code == 404 and "live" in r.json()["detail"].lower()
    assert client.post("/api/twin/simulate", json={"farm_id": "pt_30.8_75.55"}).status_code == 404


def test_health_reports_any_parcel_support(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["any_parcel_supported"] is False
    assert body["point_farm"]["requires_mode"] == "live"
    assert "AGROX_DATA_MODE=live" in body["point_farm"]["hint"]
