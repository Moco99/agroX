"""Point farms ("pt_<lat>_<lon>") anywhere on Earth, with injected fetchers (no network)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.config import DEFAULT_DERIVED_DIR
from app.providers.factory import _build, weather_for
from app.providers.live.farm import GlobalFarmProvider, zone_terrain
from app.providers.live.parcel import point_farm, point_zone_rings
from app.providers.live.soil import LiveSoilProvider
from app.providers.live.weather import LivePowerWeatherProvider
from app.providers.ports import DataNotFoundError, InvalidFarmIdError
from app.schemas.common import DataState

DERIVED = Path(DEFAULT_DERIVED_DIR)
TODAY = lambda: date(2025, 1, 3)  # noqa: E731


def test_point_farm_ids() -> None:
    assert point_farm("pt_18.83_-96.78") == (18.83, -96.78)
    assert point_farm("pt_-12.45_-55.95") == (-12.45, -55.95)
    assert point_farm("story_pilot_farm") is None
    # A pt_ id that is out of range or malformed is a client error (422), not an unknown farm (404)
    for bad in ("pt_95_10", "pt_-70_10", "pt_abc", "pt_18.8_-200", "pt_18.8"):
        with pytest.raises(InvalidFarmIdError):
            point_farm(bad)


def test_zones_tile_a_36_ha_square() -> None:
    rings = point_zone_rings(30.8, 75.55)
    assert set(rings) == {"zone_nw", "zone_ne", "zone_sw", "zone_se"}
    lons = [p[0] for r in rings.values() for p in r]
    lats = [p[1] for r in rings.values() for p in r]
    assert min(lons) < 75.55 < max(lons) and min(lats) < 30.8 < max(lats)


def test_slope_from_dem_samples() -> None:
    ring = point_zone_rings(0.0, 0.0)["zone_ne"]
    flat = zone_terrain(ring, lambda lat, lon: 100.0)
    assert flat == {"elevation": 100.0, "slope_pct": 0.0}
    # Rises 1 m per 10 m toward the east -> 10 % slope
    tilted = zone_terrain(ring, lambda lat, lon: 100.0 + lon * 111320 / 10)
    assert abs(tilted["slope_pct"] - 10.0) < 0.2


def _soilgrids(*_: object) -> dict[str, object]:
    depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
    layer = lambda name, v: {  # noqa: E731
        "name": name,
        "unit_measure": {"d_factor": 10},
        "depths": [{"label": d, "values": {"mean": v}} for d in depths],
    }
    return {"properties": {"layers": [layer("wv0033", 300), layer("wv1500", 150)]}}


def test_global_farm_uses_soilgrids_and_declares_crop(tmp_path: Path) -> None:
    soil = LiveSoilProvider(DERIVED, tmp_path, fetcher=_soilgrids, min_interval_s=0)
    farms = GlobalFarmProvider(DERIVED, soil, tmp_path, elevation=lambda lat, lon: 250.0, today=TODAY)
    farm = farms.get_farm("pt_-1.29_36.82")
    assert farm.area_ha == 36.0 and len(farm.zones) == 4
    z = farm.zones[0]
    assert z.soil.awc_mm_per_m == 150.0
    assert z.soil.provenance.data_state is DataState.ESTIMATED
    assert z.data_state is DataState.DECLARED
    assert any("crop not observed" in w for w in farm.warnings)


def test_point_weather_never_falls_back_to_pilot(tmp_path: Path) -> None:
    def boom(*_: object) -> dict[str, object]:
        raise OSError("down")

    w = LivePowerWeatherProvider(DERIVED, tmp_path, -1.29, 36.82, fetcher=boom, today=TODAY, allow_fallback=False)
    with pytest.raises(DataNotFoundError):
        w.coverage()


@pytest.mark.skipif(not (DERIVED / "manifest.json").exists(), reason="derived/ not built")
def test_point_farms_need_live_mode() -> None:
    real = _build("real", DERIVED, 1)
    assert weather_for(real, "story_pilot_farm") is real.weather
    with pytest.raises(DataNotFoundError):
        weather_for(real, "pt_18.83_-96.78")


def test_point_farm_survives_soilgrids_outage(tmp_path: Path) -> None:
    def boom(*_: object) -> dict[str, object]:
        raise TimeoutError("slow")

    provider = LiveSoilProvider(DERIVED, tmp_path, fetcher=boom, retry_delays_s=(0.0, 0.0), min_interval_s=0)
    soils = provider.get_zone_soils("pt_-12.45_-55.95")
    p = soils["zone_ne"]
    assert p.awc_mm_per_m == 150.0 and p.provenance.data_state is DataState.ESTIMATED
    assert any("SoilGrids unavailable" in w for w in p.warnings)


def test_soilgrids_deadline_bounds_first_request_and_late_answer_is_cached(tmp_path: Path) -> None:
    import threading
    import time

    release = threading.Event()

    def slow(*_: object) -> dict[str, object]:
        release.wait(5)
        return _soilgrids()

    provider = LiveSoilProvider(
        DERIVED, tmp_path, fetcher=slow, wait_s=0.1, attempt_deadline_s=0.2, retry_delays_s=(0.0,), min_interval_s=0
    )
    t0 = time.monotonic()
    soils = provider.get_zone_soils("pt_-12.45_-55.95")
    # The first request waits wait_s, never the slow fetch
    assert time.monotonic() - t0 < 1.0
    p = soils["zone_ne"]
    assert p.awc_mm_per_m == 150.0 and p.provenance.data_state is DataState.ESTIMATED
    assert any("SoilGrids request in progress" in w for w in p.warnings)
    # The attempt hits its deadline and is recorded as failed, quickly, instead of hanging
    found = provider.wait("pt_-12.45_-55.95", 2.0)
    assert found is not None and found.status == "failed" and "within" in str(found.error)
    # The slow request finally answers: its value replaces the negative entry
    release.set()
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        found = provider.status("pt_-12.45_-55.95")
        if found is not None and found.status == "ready":
            break
        time.sleep(0.05)
    assert found is not None and found.status == "ready"
    final = provider.get_zone_soils("pt_-12.45_-55.95")["zone_ne"]
    assert final.provenance.source.startswith("SoilGrids 2.0")
