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
    # rotation_weight 0: the score is the agro-climatic index alone, so it equals the single weighted indicator
    base = {**BASE, "scenario": {"temp_delta_c": 10, "precip_factor": 0.2}, "rotation_weight": 0}
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
        json={
            **BASE,
            "start": windows[0]["start"],
            "cycles": 2,
            "cycle_windows": windows,
            "twin_only": True,
            "allow_consecutive_same_crop": True,
        },
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
    assert "falta 2022-12-10" in partial.json()["detail"]
    overlapping = client.post(
        "/api/rotations/recommend",
        json={
            **BASE,
            "cycles": 2,
            "cycle_windows": [
                {"start": "2024-04-01", "end": "2024-08-01"},
                {"start": "2024-08-01", "end": "2024-10-31"},
            ],
        },
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
    "farm_id": "story_pilot_farm",
    "start": "2024-04-01",
    "end": "2024-10-31",
    "cycles": 3,
    "top_k": 3,
    "exclude_same_family": True,
    "weights": {"water": 1, "soil": 5, "climate": 10},
    "twin_only": True,
    "scenario": {"temp_delta_c": 1.5, "precip_factor": 0.8},
    "previous_crop": "corn",
    "soil_ph": 6.5,
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


def test_start_crop_fixes_first_cycle_and_is_validated() -> None:
    client = TestClient(create_app())
    ok = client.post("/api/rotations/recommend", json={**BASE, "start_crop": "soybean"})
    assert ok.status_code == 200
    recs = ok.json()["recommendations"]
    assert recs and all(r["sequence"][0] == "soybean" for r in recs)
    bad = client.post("/api/rotations/recommend", json={**BASE, "start_crop": "not_a_crop"})
    assert bad.status_code == 422


def test_short_window_rain_is_scaled_to_crop_cycle_and_warned() -> None:
    # 40-day window: raw rain compared with per-cycle EcoCrop ranges would score 0
    body = {**BASE, "start": "2024-04-01", "end": "2024-05-10", "start_crop": "corn", "top_k": 1}
    rec = TestClient(create_app()).post("/api/rotations/recommend", json=body).json()["recommendations"][0]
    cycle = rec["cycles"][0]
    assert cycle["rain_cycle_mm"] > 89  # more than the raw window total
    assert any("llevada a" in w for w in cycle["warnings"])


# ─────────────────────────────────────────
# Section: Rotation-level criteria, diversity and explanations
# ─────────────────────────────────────────


def _consecutive_repeat(sequence: list[str], previous: str | None = None) -> bool:
    history = ([previous] if previous else []) + sequence
    return any(a == b for a, b in zip(history, history[1:], strict=False))


def test_default_excludes_consecutive_same_crop_including_previous() -> None:
    body = {**BASE, "top_k": 10, "previous_crop": "corn"}
    recs = TestClient(create_app()).post("/api/rotations/recommend", json=body).json()["recommendations"]
    assert recs
    assert not any(_consecutive_repeat(item["sequence"], "corn") for item in recs)


def test_monoculture_does_not_lead_even_when_allowed() -> None:
    body = {**BASE, "top_k": 10, "allow_consecutive_same_crop": True}
    recs = TestClient(create_app()).post("/api/rotations/recommend", json=body).json()["recommendations"]
    assert len(set(recs[0]["sequence"])) > 1
    assert all(item["rotation"]["index"] == 0 for item in recs if len(set(item["sequence"])) == 1)


def test_top_alternatives_use_distinct_crop_sets_and_explain_components() -> None:
    body = {**BASE, "top_k": 5, "soil_ph": 6.5}
    response = TestClient(create_app()).post("/api/rotations/recommend", json=body).json()
    recs = response["recommendations"]
    assert len(recs) == 5
    assert len({frozenset(item["sequence"]) for item in recs}) == 5
    assert response["inputs"]["rotation_weight"] == 0.3
    for item in recs:
        assert abs(sum(item["breakdown"].values()) - item["score"]) < 1e-6
        expected = 0.7 * item["agroclimatic_score"] + 0.3 * item["rotation"]["index"]
        assert abs(item["score"] - expected) < 1e-6
        assert set(item["rotation"]["components"]) == {"family_break", "legume_before_non_legume", "family_diversity"}
        assert item["explanation"] and all(isinstance(line, str) for line in item["explanation"])
        assert any("rotación" in line for line in item["explanation"])
        for cycle in item["cycles"]:
            season = cycle["season"]
            assert cycle["window"]["start"] <= season["start"] <= season["end"] <= cycle["window"]["end"]


def test_frontend_fields_still_present() -> None:
    rec = TestClient(create_app()).post("/api/rotations/recommend", json=FRONTEND_BODY).json()["recommendations"][0]
    for key in ("sequence", "overall_score", "score", "family_repeats", "cycles", "warnings", "score_type"):
        assert key in rec
    assert rec["field_validated"] is False
    assert set(rec["weights"]) == {"water", "soil", "climate"}
    assert {"water", "soil", "climate"} <= set(rec["indicators"])
    cycle_keys = ("cycle", "crop_id", "name", "rainfall_fit", "temperature_fit", "ph_fit", "family", "data_state")
    for cycle in rec["cycles"]:
        assert all(key in cycle for key in (*cycle_keys, "window", "twin_supported", "warnings"))


def test_upstream_timeout_is_503_not_500(monkeypatch) -> None:
    from app.services import rotation_service

    def down(*_: object) -> object:
        raise TimeoutError("timed out")

    monkeypatch.setattr(rotation_service, "weather_for", down)
    response = TestClient(create_app(), raise_server_exceptions=False).post("/api/rotations/recommend", json=BASE)
    assert response.status_code == 503
    assert "reintenta" in response.json()["detail"]
