"""Drawn farms ("poly_<hash>"): validation, registration and the live providers, with injected fetchers."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.config import DEFAULT_DERIVED_DIR
from app.providers.live import parcel
from app.providers.live.farm import GlobalFarmProvider
from app.providers.live.imagery import PointImageryProvider
from app.providers.live.parcel import (
    custom_rings,
    is_simple,
    point_farm,
    register_polygon_farm,
    ring_area_ha,
    validate_polygons,
    zone_rings,
)
from app.providers.live.soil import LiveSoilProvider
from app.providers.ports import DataNotFoundError, InvalidFarmIdError
from app.schemas.common import DataState
from app.schemas.farm import PolygonFarmRequest
from app.services.farm_service import register_polygon

DERIVED = Path(DEFAULT_DERIVED_DIR)
# ~0.009 deg of latitude = 1 km; at the equator the same in longitude
SQUARE = [(0.0, 0.0), (0.0, 0.009), (0.009, 0.009), (0.009, 0.0)]
TRIANGLE = [(0.01, 0.0), (0.01, 0.004), (0.014, 0.0)]


@pytest.fixture(autouse=True)
def _store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parcel, "POLYGON_DIR", tmp_path / "parcels")


def test_area_is_about_100_ha_for_a_1_km_square() -> None:
    (ring,) = validate_polygons([SQUARE])
    assert abs(ring_area_ha(ring) - 100.2) < 1.0


def test_rejects_bad_polygons() -> None:
    bowtie = [(0.0, 0.0), (0.009, 0.009), (0.0, 0.009), (0.009, 0.0)]
    huge = [(0.0, 0.0), (0.0, 0.1), (0.1, 0.1), (0.1, 0.0)]
    for bad in (
        [],
        [SQUARE[:2]],
        [bowtie],
        [[(0.0, 0.0), (0.0, 0.0001), (0.0001, 0.0)]],
        [huge],
        [[(80.0, 0.0), (80.0, 0.01), (80.01, 0.0)]],
        [SQUARE] * 13,
    ):
        with pytest.raises(InvalidFarmIdError):
            validate_polygons(bad)
    assert not is_simple([(0, 0), (1, 1), (0, 1), (1, 0), (0, 0)])
    assert is_simple([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)])


def test_register_is_idempotent_and_zones_follow_polygons() -> None:
    fid = register_polygon_farm([SQUARE, TRIANGLE])
    assert fid.startswith("poly_") and register_polygon_farm([SQUARE, TRIANGLE]) == fid
    rings = zone_rings(DERIVED, fid)
    assert list(rings) == ["zone_1", "zone_2"] and len(rings["zone_2"]) == 4
    lat, lon = point_farm(fid) or (99.0, 99.0)
    assert 0 < lat < 0.014 and 0 < lon < 0.009
    assert custom_rings("story_pilot_farm") is None


def test_unknown_or_malformed_polygon_ids() -> None:
    with pytest.raises(DataNotFoundError):
        point_farm("poly_0.0045_0.0045_0123456789ab")
    with pytest.raises(InvalidFarmIdError):
        point_farm("poly_../../etc")


def test_service_reports_declared_areas() -> None:
    body = PolygonFarmRequest.model_validate({"polygons": [[{"lat": a, "lon": b} for a, b in SQUARE]]})
    out = register_polygon(body)
    assert out.zone_count == 1 and out.data_state is DataState.DECLARED and 99 < out.area_ha < 101


def _soilgrids(*_: object) -> dict[str, object]:
    depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
    layer = lambda name, v: {  # noqa: E731
        "name": name,
        "unit_measure": {"d_factor": 10},
        "depths": [{"label": d, "values": {"mean": v}} for d in depths],
    }
    return {"properties": {"layers": [layer("wv0033", 300), layer("wv1500", 150)]}}


def test_global_farm_builds_one_zone_per_polygon(tmp_path: Path) -> None:
    fid = register_polygon_farm([SQUARE, TRIANGLE])
    soil = LiveSoilProvider(DERIVED, tmp_path, fetcher=_soilgrids, min_interval_s=0)
    farms = GlobalFarmProvider(
        DERIVED, soil, tmp_path, elevation=lambda lat, lon: 250.0, today=lambda: date(2025, 1, 3)
    )
    farm = farms.get_farm(fid)
    assert [z.zone_id for z in farm.zones] == ["zone_1", "zone_2"]
    assert farm.zones[0].name == "Lote 1" and 99 < farm.zones[0].area_ha < 101
    assert farm.provenance["parcel"].data_state is DataState.DECLARED
    assert farm.zones[1].terrain.elevation_mean_m == 250.0
    assert farm.zones[0].soil.awc_mm_per_m == 150.0


def test_imagery_bounds_cover_the_drawing(tmp_path: Path) -> None:
    fid = register_polygon_farm([SQUARE])
    w, s, e, n = PointImageryProvider(tmp_path).bounds(fid)
    assert w < 0 < 0.009 < e and s < 0 < 0.009 < n


def test_route_registers_and_rejects() -> None:
    from fastapi.testclient import TestClient

    from app.main import create_app

    client = TestClient(create_app())
    poly = [{"lat": a, "lon": b} for a, b in SQUARE]
    ok = client.post("/api/farms/polygon", json={"polygons": [poly]})
    assert ok.status_code == 201 and ok.json()["farm_id"].startswith("poly_0.0045_0.0045_")
    bowtie = [poly[0], poly[2], poly[1], poly[3]]
    assert client.post("/api/farms/polygon", json={"polygons": [bowtie]}).status_code == 422
