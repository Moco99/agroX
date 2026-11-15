"""Rotation API uses actual farm climate and explicitly separates scenario assumptions."""
from fastapi.testclient import TestClient

from app.main import create_app

BASE = {"farm_id": "story_pilot_farm", "start": "2024-04-01", "end": "2024-10-31", "top_k": 3}


def test_farm_inputs_and_missing_ph_are_explicit() -> None:
    response = TestClient(create_app()).post("/api/rotations/recommend", json=BASE)
    assert response.status_code == 200
    body = response.json()
    assert body["inputs"]["days"] > 0
    assert body["inputs"]["climate_source"]
    assert body["inputs"]["soil_ph"] is None
    assert body["recommendations"]
    for item in body["recommendations"]:
        assert item["indicators"]["soil"] is None
        assert item["weights"]["soil"] == 0
        assert abs(sum(item["weights"].values()) - 1) < 1e-9
        assert item["score_type"] == "comparative_index"
        assert item["field_validated"] is False
        assert all("risk_level" not in cycle and "ecocrop_suitability" not in cycle for cycle in item["cycles"])


def test_scenario_changes_inputs_and_is_labelled() -> None:
    client = TestClient(create_app())
    base = client.post("/api/rotations/recommend", json=BASE).json()
    scenario = client.post(
        "/api/rotations/recommend",
        json={**BASE, "scenario": {"temp_delta_c": 2, "precip_factor": 0.7}, "soil_ph": 6.4},
    ).json()
    assert scenario["data_state"] == "SIMULATED"
    assert scenario["inputs"]["soil_ph"] == 6.4
    assert abs(scenario["inputs"]["t_mean"] - base["inputs"]["t_mean"] - 2) < 0.02
    assert abs(scenario["inputs"]["rain_mm"] - 0.7 * base["inputs"]["rain_mm"]) < 0.02
    assert scenario["recommendations"][0]["indicators"]["soil"] is not None


def test_validation_and_missing_farms() -> None:
    client = TestClient(create_app())
    assert client.post("/api/rotations/recommend", json={}).status_code == 422
    assert client.post("/api/rotations/recommend", json={**BASE, "cycles": 50}).status_code == 422
    assert client.post("/api/rotations/recommend", json={**BASE, "soil_ph": 15}).status_code == 422
    assert client.post("/api/rotations/recommend", json={**BASE, "farm_id": "unknown"}).status_code == 404
    assert client.post("/api/rotations/recommend", json={**BASE, "previous_crop": "invalid"}).status_code == 422


def test_synthetic_inputs_stay_synthetic_under_scenario(monkeypatch) -> None:
    monkeypatch.setenv("AGROX_DATA_MODE", "synthetic")
    response = TestClient(create_app()).post(
        "/api/rotations/recommend", json={**BASE, "scenario": {"temp_delta_c": 2, "precip_factor": 0.7}}
    )
    assert response.status_code == 200
    assert response.json()["data_state"] == "SYNTHETIC"
    assert response.json()["inputs"]["scenario"]["temp_delta_c"] == 2


def test_missing_required_ecocrop_thresholds_are_not_ranked(monkeypatch) -> None:
    from app.services.rotation_service import engine

    crop_engine = engine().ecocrop
    original = crop_engine.score_crop

    def incomplete(scientific_name: str, *args: float, **kwargs: float) -> dict:
        result = original(scientific_name, *args, **kwargs)
        if scientific_name == "Zea mays":
            result["warnings"].append("Missing temperature input or thresholds; score uses neutral/fallback values")
        return result

    monkeypatch.setattr(crop_engine, "score_crop", incomplete)
    response = TestClient(create_app()).post("/api/rotations/recommend", json={**BASE, "top_k": 10})
    assert response.status_code == 200
    assert response.json()["recommendations"]
    assert all("corn" not in item["sequence"] for item in response.json()["recommendations"])


def test_reweighting_changes_comparisons_and_breakdown() -> None:
    client = TestClient(create_app())
    base = {**BASE, "scenario": {"temp_delta_c": 10, "precip_factor": 0.2}}
    water = client.post(
        "/api/rotations/recommend", json={**base, "soil_ph": 6.4, "weights": {"water": 1, "soil": 0, "climate": 0}}
    ).json()["recommendations"][0]
    climate = client.post(
        "/api/rotations/recommend", json={**base, "soil_ph": 6.4, "weights": {"water": 0, "soil": 0, "climate": 1}}
    ).json()["recommendations"][0]
    assert abs(water["score"] - water["indicators"]["water"]) < 1e-6
    assert abs(climate["score"] - climate["indicators"]["climate"]) < 1e-6
    assert abs(sum(water["breakdown"].values()) - water["score"]) < 1e-6
    assert water["sequence"] != climate["sequence"] or water["score"] != climate["score"]


def test_twin_candidates_and_distinct_cycle_weather() -> None:
    client = TestClient(create_app())
    windows = [
        {"start": "2023-04-01", "end": "2023-10-31"},
        {"start": "2024-04-01", "end": "2024-10-31"},
    ]
    response = client.post(
        "/api/rotations/recommend",
        json={**BASE, "start": windows[0]["start"], "cycles": 2, "cycle_windows": windows, "twin_only": True},
    )
    assert response.status_code == 200
    body = response.json()
    climates = body["inputs"]["cycle_windows"]
    assert [item["days"] for item in climates] == [214, 214]
    assert climates[0]["rain_mm"] != climates[1]["rain_mm"]
    assert body["recommendations"]
    for item in body["recommendations"]:
        assert set(item["sequence"]) <= {"corn", "soybean"}
        assert [cycle["window"] for cycle in item["cycles"]] == windows
        assert all(cycle["twin_supported"] for cycle in item["cycles"])
    repeated = next(item for item in body["recommendations"] if len(set(item["sequence"])) == 1)
    assert repeated["cycles"][0]["rainfall_fit"] != repeated["cycles"][1]["rainfall_fit"]


def test_incomplete_climate_and_overlapping_windows_are_rejected() -> None:
    client = TestClient(create_app())
    partial = client.post("/api/rotations/recommend", json={**BASE, "start": "2022-12-10", "end": "2023-01-10"})
    assert partial.status_code == 422
    assert "Datos climáticos incompletos" in partial.json()["detail"]
    overlapping = client.post(
        "/api/rotations/recommend",
        json={**BASE, "cycles": 2, "cycle_windows": [
            {"start": "2024-04-01", "end": "2024-08-01"},
            {"start": "2024-08-01", "end": "2024-10-31"},
        ]},
    )
    assert overlapping.status_code == 422
    assert "no solaparse" in overlapping.json()["detail"][0]["msg"]


def test_equal_indices_prefer_fewer_consecutive_family_repetitions(monkeypatch) -> None:
    from app.services.rotation_service import engine

    crop_engine = engine().ecocrop
    original = crop_engine.score_crop

    def equal_fit(scientific_name: str, *args: float, **kwargs: float) -> dict:
        return {
            **original(scientific_name, *args, **kwargs),
            "score_temperature": 100.0,
            "score_rain": 100.0,
        }

    monkeypatch.setattr(crop_engine, "score_crop", equal_fit)
    client = TestClient(create_app())
    response = client.post("/api/rotations/recommend", json={**BASE, "twin_only": True, "top_k": 8})
    assert response.status_code == 200
    ranked = response.json()["recommendations"]
    assert ranked[0]["family_repeats"] == 0
    assert [(-item["score"], item["family_repeats"]) for item in ranked] == sorted(
        (-item["score"], item["family_repeats"]) for item in ranked
    )


# Mirrors the body built by frontend rotation-screen.tsx with every optional control filled in
FRONTEND_BODY = {
    "farm_id": "story_pilot_farm", "start": "2024-04-01", "end": "2024-10-31", "cycles": 3, "top_k": 3,
    "exclude_same_family": True, "weights": {"water": 1, "soil": 5, "climate": 10}, "twin_only": True,
    "scenario": {"temp_delta_c": 1.5, "precip_factor": 0.8}, "previous_crop": "corn", "soil_ph": 6.5,
    "cycle_windows": [
        {"start": "2024-04-01", "end": "2024-05-31"},
        {"start": "2024-06-01", "end": "2024-07-31"},
        {"start": "2024-08-01", "end": "2024-10-31"},
    ],
}


def test_exact_frontend_payload_is_accepted() -> None:
    client = TestClient(create_app())
    assert client.post("/api/rotations/recommend", json=FRONTEND_BODY).status_code == 200
    optional = ("previous_crop", "soil_ph", "cycle_windows")
    without_optionals = {k: v for k, v in FRONTEND_BODY.items() if k not in optional}
    assert client.post("/api/rotations/recommend", json=without_optionals).status_code == 200


def test_unknown_field_is_rejected_with_its_location() -> None:
    body = {**FRONTEND_BODY, "weights": {"water": 1, "soil": 1, "climate": 1, "agua": 1}}
    response = TestClient(create_app()).post("/api/rotations/recommend", json=body)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "weights", "agua"]
