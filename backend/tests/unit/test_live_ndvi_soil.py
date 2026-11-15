"""Live NDVI and soil adapters with injected fetchers (no network)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pytest

from app.config import DEFAULT_DERIVED_DIR
from app.providers.live.observations import LiveObservationProvider, zone_masks, zone_ndvi
from app.providers.live.parcel import inside, zone_rings
from app.providers.live.soil import LiveSoilProvider, awc_mm_per_m
from app.schemas.common import DataState

DERIVED = Path(DEFAULT_DERIVED_DIR)
FARM = "story_pilot_farm"
needs_derived = pytest.mark.skipif(not (DERIVED / "parcel" / f"{FARM}.geojson").exists(), reason="derived/ not built")
TODAY = lambda: date(2025, 1, 3)  # noqa: E731


def _scene_array(red: int, nir: int, scl: int, h: int = 10, w: int = 10) -> np.ndarray:
    return np.stack([np.full((h, w), red), np.full((h, w), nir), np.full((h, w), scl), np.full((h, w), 255)])


def test_point_in_polygon() -> None:
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]
    assert inside(0.5, 0.5, square)
    assert not inside(1.5, 0.5, square)


def test_zone_ndvi_offset_by_baseline_and_cloud_mask() -> None:
    bbox = [0.0, 0.0, 1.0, 1.0]
    rings = {"z": [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]}
    # Same reflectance (red 0.1, nir 0.3 -> NDVI 0.5) stored without and with the +1000 offset
    masks = zone_masks((10, 10), bbox, rings)
    assert zone_ndvi(_scene_array(1000, 3000, 4), masks, "03.00")["z"][0] == 0.5
    assert zone_ndvi(_scene_array(2000, 4000, 4), masks, "05.11")["z"][0] == 0.5
    # Cloud (SCL 9): no clear pixel -> zone omitted
    assert zone_ndvi(_scene_array(2000, 4000, 9), masks, "05.11") == {}


def _soilgrids(wv33: int, wv1500: int) -> dict[str, object]:
    depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
    layer = lambda name, v: {  # noqa: E731
        "name": name,
        "unit_measure": {"d_factor": 10},
        "depths": [{"label": d, "values": {"mean": v}} for d in depths],
    }
    return {"properties": {"layers": [layer("wv0033", wv33), layer("wv1500", wv1500)]}}


def test_awc_from_water_contents() -> None:
    # 32.8 % - 15.0 % volume = 17.8 % -> 178 mm per m
    assert awc_mm_per_m(_soilgrids(328, 150)) == 178.0
    missing = _soilgrids(328, 150)
    missing["properties"]["layers"][0]["depths"][2]["values"]["mean"] = None  # type: ignore[index]
    assert awc_mm_per_m(missing) is None


@needs_derived
def test_live_soil_keeps_ssurgo_and_adds_cross_check(tmp_path: Path) -> None:
    soils = LiveSoilProvider(DERIVED, tmp_path, fetcher=lambda *_: _soilgrids(328, 150), min_interval_s=0)
    soils_by_zone = soils.get_zone_soils(FARM)
    assert set(soils_by_zone) == set(zone_rings(DERIVED, FARM))
    p = next(iter(soils_by_zone.values()))
    assert p.provenance.data_state is DataState.MEASURED
    assert any("SoilGrids 250 m cross-check: AWC 178.0" in w for w in p.warnings)


@needs_derived
def test_live_ndvi_series_and_fallback(tmp_path: Path) -> None:
    scenes = [
        {"id": "a", "date": "2021-07-01", "baseline": "03.00"},
        {"id": "b", "date": "2024-07-01", "baseline": "05.11"},
    ]
    values = {"a": (1000, 3000), "b": (2000, 4000)}

    def crop(item: str, _bbox: list[float], width: int, height: int) -> np.ndarray:
        return _scene_array(*values[item], 4, height, width)

    live = LiveObservationProvider(DERIVED, tmp_path, search=lambda *_: scenes, crop=crop, today=TODAY)
    series = live.ndvi_series(FARM, "sentinel2")
    assert {p.value for p in series.points} == {0.5}
    assert {p.zone_id for p in series.points} == set(zone_rings(DERIVED, FARM))
    assert "live" in series.provenance.source

    def boom(*_: object) -> list[dict[str, str]]:
        raise OSError("down")

    fallback = LiveObservationProvider(DERIVED, tmp_path / "x", search=boom, today=TODAY).ndvi_series(FARM, "sentinel2")
    assert any("Sentinel-2 API failed" in w for w in fallback.warnings)
    assert fallback.points
