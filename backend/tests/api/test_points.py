"""Point endpoint validates bounds and keeps independent source failures explicit."""

import math

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import point_service


@pytest.fixture
def client(monkeypatch):
    def fake_query(lat, lon, start, end, refresh):
        return {
            "cobertura": {"es_cultivo": True},
            "terreno": {"elevacion_m": 300},
            "suelo": {"error": "secret-url?token=do-not-expose"},
            "clima": {"diario": {"T2M": {"20240101": 20}}},
            "vegetacion": {"serie": []},
            "aptitud": {"cultivos": {}},
            "segundos": {"suelo": 2, "terreno": math.nan},
        }

    monkeypatch.setattr(point_service, "query", fake_query)
    return TestClient(create_app())


def test_partial_errors_are_typed_and_sanitized(client):
    response = client.post(
        "/api/points/query", json={"lat": 30.8, "lon": 75.55, "start": "2024-01-01", "end": "2024-02-01"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["sections"]["terrain"]["data"]["elevacion_m"] == 300
    assert body["sections"]["terrain"]["elapsed_s"] == 0
    assert body["sections"]["soil"]["status"] == "error"
    assert body["sections"]["soil"]["data"] is None
    assert body["sections"]["soil"]["elapsed_s"] == 2
    assert "do-not-expose" not in response.text
    assert body["sections"]["climate"]["data_state"] == "ESTIMATED"


@pytest.mark.parametrize(
    "body",
    [
        {"lat": 91, "lon": 0},
        {"lat": 0, "lon": 181},
        {"lat": 0, "lon": 0, "start": "2024-01-01", "end": "2023-01-01"},
        {"lat": 0, "lon": 0, "start": "2020-01-01", "end": "2024-01-01"},
        {"lat": 0, "lon": 0, "end": "2099-01-01"},
        {"lat": "NaN", "lon": 0},
    ],
)
def test_validation_rejects_unbounded_inputs(client, body):
    assert client.post("/api/points/query", json=body).status_code == 422


def test_nonfinite_source_is_one_section_error(client, monkeypatch):
    monkeypatch.setattr(point_service, "query", lambda *args: {"clima": {"bad": math.inf}})
    response = client.post("/api/points/query", json={"lat": 0, "lon": 0})
    assert response.status_code == 200
    assert response.json()["sections"]["climate"]["status"] == "error"


def test_coordinate_echo_matches_sampled_precision(client):
    response = client.post("/api/points/query", json={"lat": 30.12345678, "lon": 75.87654321})
    assert response.json()["point"] == {"lat": 30.12346, "lon": 75.87654}


def test_nonstandard_nonfinite_json_is_validation_error(client):
    response = client.post(
        "/api/points/query", content='{"lat":NaN,"lon":0}', headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
