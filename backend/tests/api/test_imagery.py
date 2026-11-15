"""Imagery grids and date selection stay aligned and bounded."""

from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def test_artifacts_share_bounds_and_grid() -> None:
    client = TestClient(create_app())
    meta = client.get("/api/imagery/meta").json()
    height = client.get("/api/terrain/heightmap").json()
    assert meta["bounds_wgs84"] == height["bounds_wgs84"]
    assert len(height["data"]) == height["width"] * height["height"]
    assert height["row_order"] == "north_to_south"
    days = client.get("/api/imagery/ndvi/dates").json()["dates"]
    day = next(d["date"] for d in days if d["prerendered"])
    image = client.get("/api/imagery/ndvi", params={"date": day, "size": 128})
    assert image.status_code == 200
    with Image.open(BytesIO(image.content)) as png:
        assert max(png.size) <= 128
        assert png.mode == "RGBA"


def test_invalid_requests_do_not_resolve_arbitrary_paths() -> None:
    client = TestClient(create_app())
    assert client.get("/api/imagery/meta", params={"farm_id": "../secret"}).status_code == 404
    assert client.get("/api/imagery/basemap?size=99999").status_code == 422
    assert client.get("/api/imagery/ndvi?date=2024-01-01").status_code == 404


def test_region_period_and_provenance() -> None:
    client = TestClient(create_app())
    result = client.get("/api/region/summary")
    assert result.status_code == 200
    data = result.json()
    assert data["provenance"]
    assert data["suitability"] is None
    assert data["ndvi_series"]
    assert client.get("/api/region/summary?period_start=2025-01-01&period_end=2024-01-01").status_code == 422


def test_s3_image_uses_bounded_runtime_grid(monkeypatch) -> None:
    import numpy as np

    from app.providers.imagery.rasters import S2Scene
    from app.services import imagery_service

    monkeypatch.setenv('AGROX_DATA_SOURCE', 's3')
    monkeypatch.setattr(imagery_service, 'get_store', lambda: object())
    monkeypatch.setattr(imagery_service, 'list_s2_scenes', lambda _: [
        S2Scene('test-scene', '2024-07-15', '20240715', {})])

    def read_scene(store, scene, grid):
        assert grid.width <= 256 and grid.height <= 256
        assert grid.bounds[0] < grid.bounds[2]
        return np.full((grid.height, grid.width), .7), np.ones((grid.height, grid.width), dtype=bool)

    monkeypatch.setattr(imagery_service, 'read_scene_ndvi', read_scene)
    client = TestClient(create_app())
    assert client.get('/api/imagery/ndvi?date=2024-07-15').status_code == 200
    assert client.get('/api/imagery/ndvi?date=2024-01-01').status_code == 404
