"""API boundary: malformed inputs answer 4xx with a message, never 500."""

from fastapi.testclient import TestClient

from app.main import create_app


def test_out_of_range_year_is_422() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)
    for year in (0, 99999):
        assert client.get(f"/api/twin/observed-vs-simulated?year={year}").status_code == 422


def test_reversed_observation_period_is_422() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)
    for path in ("/api/observations/ndvi", "/api/observations/soil-moisture"):
        response = client.get(f"{path}?start=2024-10-01&end=2024-01-01")
        assert response.status_code == 422
        assert "end must be on or after start" in response.json()["detail"]
