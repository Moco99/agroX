"""API: routes, validation (422/404), data_state and provenance on every response, in both data modes."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["data_mode"] in ("real", "synthetic")
    assert body["data_state"] in ("MEASURED", "SYNTHETIC")


def test_crops(client: TestClient) -> None:
    body = client.get("/api/crops").json()
    assert body["catalog_version"] == "catalog_v1"
    assert all(c["verified"] is False for c in body["crops"])
    assert body["provenance"]["data_state"] in ("ESTIMATED", "SYNTHETIC")


def test_climate(client: TestClient) -> None:
    r = client.get("/api/climate", params={"start": "2024-04-01", "end": "2024-10-31"})
    assert r.status_code == 200
    body = r.json()
    assert body["indicators"]["et0_total"]["value"] > 0
    assert body["indicators"]["spi"]["value"] is None
    assert any("SPI" in w for w in body["warnings"])
    assert client.get("/api/climate", params={"start": "2024-05-01", "end": "2024-04-01"}).status_code == 422
    assert client.get("/api/climate", params={"start": "1990-01-01", "end": "1990-02-01"}).status_code == 422


def test_farm(client: TestClient) -> None:
    body = client.post("/api/farms/analyze", json={"farm_id": "story_pilot_farm"}).json()
    assert len(body["farm"]["zones"]) == 4
    assert set(body["latest_ndvi"]) == {z["zone_id"] for z in body["farm"]["zones"]}
    assert client.get("/api/farms/nope").status_code == 404


def test_twin_simulate_baseline_and_scenario(client: TestClient) -> None:
    base = client.post("/api/twin/simulate", json={}).json()
    assert base["twin_level"] in ("DIGITAL_SHADOW", "DIGITAL_MODEL")
    assert base["provenance"]["weather"]["data_state"] in ("MEASURED", "SYNTHETIC")
    assert all(z["data_state"] in ("ESTIMATED", "SYNTHETIC") for z in base["zones"])
    drought = client.post("/api/twin/simulate", json={"scenario": {"preset": "severe_drought"}}).json()
    assert drought["scenario_expanded"]["precip_factor"] == 0.4
    for b, d in zip(base["zones"], drought["zones"], strict=True):
        assert d["summary"]["mean_ks"] <= b["summary"]["mean_ks"]
        assert d["data_state"] in ("SIMULATED", "SYNTHETIC")
    irrigated = client.post(
        "/api/twin/simulate", json={"scenario": {"preset": "severe_drought", "irrigation_level": "HIGH"}}
    ).json()
    assert all(z["irrigation_level"] == "HIGH" for z in irrigated["zones"])
    assert irrigated["farm_summary"]["total_irrigation_mm"] > 0


def test_twin_simulate_validation(client: TestClient) -> None:
    assert client.post("/api/twin/simulate", json={"scenario": {"preset": "nope"}}).status_code == 422
    assert client.post("/api/twin/simulate", json={"scenario": {"precip_factor": 9}}).status_code == 422
    assert client.post("/api/twin/simulate", json={"start": "2023-06-01", "end": "2024-06-01"}).status_code == 422
    assert client.post("/api/twin/simulate", json={"zone_ids": ["zone_x"]}).status_code == 404
    assert client.post("/api/twin/simulate", json={"farm_id": "nope"}).status_code == 404


def test_twin_simulate_fork_and_monte_carlo(client: TestClient) -> None:
    body = client.post(
        "/api/twin/simulate",
        json={
            "zone_ids": ["zone_nw"],
            "fork_date": "2024-07-01",
            "scenario": {"precip_factor": 0.5},
            "monte_carlo": {"n": 8, "seed": 1},
        },
    ).json()
    states = body["zones"][0]["states"]
    before = [s for s in states if s["date"] <= "2024-07-01"]
    after = [s for s in states if s["date"] > "2024-07-01"]
    assert before and after
    assert body["zones"][0]["monte_carlo"]["n"] == 8
    if body["data_mode"] == "real":
        assert all(s["data_state"] == "ESTIMATED" for s in before)
        assert all(s["data_state"] == "SIMULATED" for s in after)


def test_twin_state_and_config(client: TestClient) -> None:
    body = client.get("/api/twin/state", params={"date": "2024-07-15"}).json()
    assert len(body["zones"]) == 4
    assert all(z["state"]["date"] == "2024-07-15" for z in body["zones"])
    assert client.get("/api/twin/state", params={"date": "1999-01-01"}).status_code == 422
    cfg = client.get("/api/twin/config").json()
    assert set(cfg["irrigation_levels"]) == {"NONE", "LOW", "MEDIUM", "HIGH"}
    assert "moderate_drought" in cfg["presets"]


def test_observations(client: TestClient) -> None:
    ndvi = client.get("/api/observations/ndvi", params={"source": "modis_ndvi"}).json()
    assert ndvi["points"] and ndvi["provenance"]["data_state"] in ("MEASURED", "SYNTHETIC")
    sm = client.get("/api/observations/soil-moisture", params={"start": "2024-01-01"}).json()
    assert all(p["date"] >= "2024-01-01" for p in sm["points"])
    overlay = client.get("/api/observations/ndvi-overlay")
    health = client.get("/api/health").json()
    if health["data_mode"] == "real":
        assert overlay.status_code == 200 and overlay.json()["resolution_m"] == 10
    else:
        assert overlay.status_code == 404
    vs = client.get("/api/twin/observed-vs-simulated").json()
    assert all(z["comparison"] for z in vs["zones"])
