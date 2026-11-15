"""Imagery, relief and NDVI overlay of a point farm with injected Planetary Computer fetchers (no network)."""

from __future__ import annotations

import base64
from datetime import date
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.deps import providers_dep
from app.config import DEFAULT_DERIVED_DIR
from app.main import create_app
from app.providers.factory import Providers
from app.providers.live.imagery import DEM, S2, PointImageryProvider
from app.providers.live.observations import LiveObservationProvider
from app.providers.live.soil import LiveSoilProvider
from app.providers.ports import DataNotFoundError

DERIVED = Path(DEFAULT_DERIVED_DIR)
PT = "pt_18.83_-96.78"
TODAY = date(2025, 1, 3)
SCENES = [
    {"id": "s2_new", "date": "2024-12-20", "cloud": 3.0, "baseline": "05.11"},
    {"id": "s2_old", "date": "2024-12-05", "cloud": 8.0, "baseline": "05.11"},
]


def _search(bounds, collection, period, max_cloud, limit):  # type: ignore[no-untyped-def]
    if collection == DEM:
        return [{"id": "dem_tile"}]
    assert collection == S2
    return SCENES


def _crop(collection, item, bbox, width, height, assets):  # type: ignore[no-untyped-def]
    full = lambda v, dt=np.uint8: np.full((height, width), v, dtype=dt)  # noqa: E731
    if assets == ("visual", "SCL"):
        return np.stack([full(90), full(140), full(60), full(4)])
    if assets == ("B04", "B08", "SCL"):
        return np.stack([full(2000, np.uint16), full(4000, np.uint16), full(4, np.uint16)])
    assert assets == ("data",) and collection == DEM
    # Elevation rises to the east; second band is the validity mask the API appends
    ramp = np.tile(np.linspace(100.0, 130.0, width), (height, 1))
    return np.stack([ramp, np.full((height, width), 255.0)])


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    imagery = PointImageryProvider(tmp_path, search=_search, crop=_crop, today=lambda: TODAY)

    def search_scenes(_bbox, _end):  # type: ignore[no-untyped-def]
        return SCENES

    def crop_scene(_item, _bbox, width, height):  # type: ignore[no-untyped-def]
        return np.stack([np.full((height, width), v) for v in (2000, 4000, 4, 255)])

    observations = LiveObservationProvider(
        DERIVED, tmp_path, search=search_scenes, crop=crop_scene, today=lambda: TODAY
    )
    providers = Providers(
        mode="live",
        weather=None,  # type: ignore[arg-type]
        soil=None,  # type: ignore[arg-type]
        catalog=None,  # type: ignore[arg-type]
        farm=None,  # type: ignore[arg-type]
        observations=observations,
        point_imagery=imagery,
        live_observations=observations,
        live_soil=LiveSoilProvider(DERIVED, tmp_path),
    )
    app = create_app()
    app.dependency_overrides[providers_dep] = lambda: providers
    return TestClient(app)


def test_basemap_is_s2_true_colour_with_provenance_headers(client: TestClient) -> None:
    r = client.get("/api/imagery/basemap", params={"farm_id": PT, "size": 256})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "Sentinel-2" in r.headers["x-imagery-source"] and r.headers["x-imagery-acquired"] == "2024-12-20"
    with Image.open(BytesIO(r.content)) as img:
        assert max(img.size) <= 256


def test_ndvi_dates_image_and_overlay(client: TestClient) -> None:
    dates = client.get("/api/imagery/ndvi/dates", params={"farm_id": PT})
    assert dates.status_code == 200
    body = dates.json()
    assert [d["date"] for d in body["dates"]] == ["2024-12-05", "2024-12-20"]
    assert body["data_state"] == "MEASURED" and all(d["cloud_free"] for d in body["dates"])
    img = client.get("/api/imagery/ndvi", params={"farm_id": PT, "date": "2024-12-20", "size": 128})
    assert img.status_code == 200
    with Image.open(BytesIO(img.content)) as png:
        assert png.mode == "RGBA"
    ov = client.get("/api/observations/ndvi-overlay", params={"farm_id": PT})
    assert ov.status_code == 200
    doc = ov.json()
    assert doc["date"] == "2024-12-20" and doc["data_state"] == "MEASURED"
    assert set(doc["bounds"]) == {"west", "south", "east", "north"}
    with Image.open(BytesIO(base64.b64decode(doc["png_base64"]))) as png:
        assert png.size == (doc["width_px"], doc["height_px"])
    meta = client.get("/api/imagery/meta", params={"farm_id": PT}).json()
    assert [doc["bounds"][k] for k in ("west", "south", "east", "north")] == meta["bounds_wgs84"]


def test_heightmap_from_copernicus_dem(client: TestClient) -> None:
    r = client.get("/api/terrain/heightmap", params={"farm_id": PT})
    assert r.status_code == 200
    h = r.json()
    assert len(h["data"]) == h["width"] * h["height"] and h["row_order"] == "north_to_south"
    assert 100 <= h["min_m"] < h["max_m"] <= 130
    assert "Copernicus DEM GLO-30" in h["provenance"]["source"] and h["data_state"] == "MEASURED"
    meta = client.get("/api/imagery/meta", params={"farm_id": PT}).json()
    assert h["bounds_wgs84"] == meta["bounds_wgs84"]


def test_no_scene_is_a_404_not_a_crash(tmp_path: Path) -> None:
    empty = PointImageryProvider(tmp_path, search=lambda *_: [], crop=_crop, today=lambda: TODAY)
    with pytest.raises(DataNotFoundError):
        empty.basemap(PT)
    with pytest.raises(DataNotFoundError):
        empty.heightmap(PT)
