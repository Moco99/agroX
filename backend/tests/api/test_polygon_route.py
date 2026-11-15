"""POST /api/farms/polygon must stay routable (a 405 here means the running backend predates the route)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.live import parcel

TRIANGLE = [{"lat": 42.03, "lon": -93.63}, {"lat": 42.03, "lon": -93.62}, {"lat": 42.04, "lon": -93.62}]


@pytest.fixture(autouse=True)
def _store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parcel, "POLYGON_DIR", tmp_path / "parcels")


def test_post_polygon_is_registered_and_not_shadowed_by_farm_id_route() -> None:
    client = TestClient(create_app())
    response = client.post("/api/farms/polygon", json={"polygons": [TRIANGLE]})
    assert response.status_code == 201
    assert response.json()["farm_id"].startswith("poly_")
    # The path-parameter route only serves GET; POST must never fall through to it
    assert client.get("/api/farms/polygon").status_code != 201
