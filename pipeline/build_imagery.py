"""Farm imagery for the map and the 3D scene: NAIP basemap, SRTM heightmap and the shared meta.

Outputs (derived/imagery/ and derived/terrain/):
  imagery/basemap_<farm>.jpg      NAIP RGB clipped to the farm + margin, resampled to BASEMAP_SIZE px (long side)
  imagery/meta.json               common bounds, basemap facts, NDVI date index (filled by build_ndvi)
  terrain/heightmap_<farm>.json   NASADEM elevation grid on the same bounds (30 m, smooth relief)

Everything shares one WGS84 bounds box (farm bbox + margin) so layers drape on each other exactly.
Inputs come from the ObjectStore (S3 windowed reads or data/raw).
"""

from __future__ import annotations

import json
import re
from typing import Any

import numpy as np
from PIL import Image
from rasterio.windows import from_bounds

from app.providers.imagery.rasters import Grid, read_window
from app.storage.factory import get_store
from pipeline.common import DERIVED_DIR, FARM_ID, farm_area_bounds, register_artifact, relative_to_derived, write_json
from pipeline.fetch_naip import read_naip_window

BASEMAP_SIZE = 2048
# Below this share of valid NAIP pixels in the area the Planetary Computer fallback is tried
MIN_COVERAGE = 0.95
JPEG_QUALITY = 85
NAIP_PREFIX = "naip/"
SRTM_KEY = "srtm/NASADEM_HGT_n42w094_elevation.tif"
DEM_NODATA = -32768
METERS_PER_DEG_LAT = 111_320.0


def _meters(bounds: tuple[float, float, float, float]) -> tuple[float, float]:
    west, south, east, north = bounds
    mid = (south + north) / 2
    width = (east - west) * METERS_PER_DEG_LAT * float(np.cos(np.radians(mid)))
    return width, (north - south) * METERS_PER_DEG_LAT


def build_basemap() -> dict[str, Any]:
    store = get_store()
    bounds = farm_area_bounds()
    tiles = [o.key for o in store.list_objects(NAIP_PREFIX) if o.key.endswith("_image.tif")]
    if not tiles:
        raise RuntimeError("no NAIP tiles in the active store")
    with store.open_raster(tiles[0]) as src:
        res_deg = (abs(src.res[0]), abs(src.res[1]))
    west, south, east, north = bounds
    native = Grid(bounds, int(round((east - west) / res_deg[0])), int(round((north - south) / res_deg[1])))
    rgb = np.zeros((native.height, native.width, 3), dtype=np.uint8)
    filled = np.zeros((native.height, native.width), dtype=bool)
    names: list[str] = []
    for key in sorted(tiles):
        # Bands: R, G, B, NIR, alpha (255 where the quad has data); tiles overlap only at their edges
        data = read_window(store, key, native, (1, 2, 3, 5))
        usable = (data[3] > 0) & ~filled
        if usable.any():
            rgb[usable] = np.moveaxis(data[:3], 0, -1)[usable]
            filled |= usable
            names.append(key)
    coverage = float(filled.mean())
    width_m, height_m = _meters(bounds)
    long_side = max(width_m, height_m)
    out_w = int(round(BASEMAP_SIZE * width_m / long_side))
    out_h = int(round(BASEMAP_SIZE * height_m / long_side))
    image = Image.fromarray(rgb, "RGB").resize((out_w, out_h), Image.Resampling.LANCZOS)
    fallback: dict[str, str] | None = None
    source = "USDA NAIP (4-band aerial imagery, 2 quads), resampled by the scraper"
    if coverage < MIN_COVERAGE:
        # The scraped quads miss the farm: read the right quad straight from Planetary Computer (needs network)
        try:
            pc, fallback = read_naip_window(Grid(bounds, out_w, out_h))
            if (pc[:3].max(axis=0) > 0).mean() > coverage:
                image = Image.fromarray(np.moveaxis(pc[:3], 0, -1).copy(), "RGB")
                coverage = float((pc[:3].max(axis=0) > 0).mean())
                names = [f"planetary-computer:{fallback['item']}"]
                source = "USDA NAIP via Microsoft Planetary Computer (quad covering the farm; raw mirror quads do not)"
        except Exception as exc:  # noqa: BLE001 - offline rebuilds keep the partial basemap and say so
            print(f"[imagery] NAIP fallback unavailable ({type(exc).__name__}); basemap coverage={coverage:.2f}")
    out = DERIVED_DIR / "imagery" / f"basemap_{FARM_ID}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    acquired = fallback["acquired"] if fallback else None
    for key in names:
        m = re.search(r"_(\d{4})(\d{2})(\d{2})_\d{8}_image", key)
        if m:
            acquired = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    if fallback:
        # Output pixel size (the 0.3 m source is averaged down to fit BASEMAP_SIZE)
        native_res_m = round(long_side / BASEMAP_SIZE, 1)
    else:
        native_res_m = round(
            (
                (res_deg[0] * METERS_PER_DEG_LAT * float(np.cos(np.radians((south + north) / 2))))
                + res_deg[1] * METERS_PER_DEG_LAT
            )
            / 2,
            1,
        )
    resample_note = (
        f"windowed from the {fallback['gsd_m']} m COG"
        if fallback else "Lanczos upsample of the scraped, downsampled NAIP"
    )
    info = {
        "file": relative_to_derived(out),
        "width": out_w,
        "height": out_h,
        "native_width": native.width,
        "native_height": native.height,
        "source": source,
        "acquired": acquired,
        "resolution_m": native_res_m,
        "coverage_fraction": round(coverage, 3),
        "tiles": [k.removeprefix(NAIP_PREFIX) for k in names],
        "note": f"Native pixel ~{native_res_m} m; output {out_w}x{out_h} px "
        f"({resample_note}).",
    }
    print(f"[imagery] basemap {out_w}x{out_h} coverage={coverage:.2f} size={out.stat().st_size // 1024} KB")
    return info


def build_heightmap() -> dict[str, Any]:
    store = get_store()
    bounds = farm_area_bounds()
    west, south, east, north = bounds
    with store.open_raster(SRTM_KEY) as src:
        res_deg = (abs(src.res[0]), abs(src.res[1]))
        window = from_bounds(*bounds, transform=src.transform)
    grid = Grid(bounds, int(round((east - west) / res_deg[0])), int(round((north - south) / res_deg[1])))
    # Bilinear onto the grid: the DEM is 30 m, nearest would stair-step the 3D terrain
    raw = read_window(store, SRTM_KEY, grid, (1,), nearest=False)[0].astype(np.float64)
    del window
    bad = raw <= DEM_NODATA + 1
    if bad.all():
        raise RuntimeError("DEM window is all nodata")
    nodata_fraction = float(bad.mean())
    if bad.any():
        raw = np.where(bad, float(np.median(raw[~bad])), raw)
    res_m = round(
        (
            res_deg[1] * METERS_PER_DEG_LAT
            + res_deg[0] * METERS_PER_DEG_LAT * float(np.cos(np.radians((south + north) / 2)))
        )
        / 2,
        1,
    )
    payload = {
        "farm_id": FARM_ID,
        "bounds_wgs84": list(bounds),
        "width": grid.width,
        "height": grid.height,
        "min_m": round(float(raw.min()), 1),
        "max_m": round(float(raw.max()), 1),
        "resolution_m": res_m,
        "row_order": "north_to_south",
        "data": [round(float(v), 1) for v in raw.ravel()],
        "source": "NASADEM HGT 1 arc-second (SRTM reprocessed)",
        "data_state": "MEASURED",
        "nodata_fraction": round(nodata_fraction, 3),
        "note": "30 m source: gentle relief, vertical noise ~1-2 m. Use for illustrative 3D terrain, not for "
        "hydrology or engineering.",
    }
    out = DERIVED_DIR / "terrain" / f"heightmap_{FARM_ID}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Compact JSON: the grid has thousands of values
    out.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"[imagery] heightmap {grid.width}x{grid.height} {payload['min_m']}..{payload['max_m']} m")
    return {"info": payload, "path": out}


def build() -> None:
    basemap = build_basemap()
    height = build_heightmap()
    meta = {
        "farm_id": FARM_ID,
        "bounds_wgs84": list(farm_area_bounds()),
        "crs": "EPSG:4326",
        "basemap": basemap,
        "data_state": "MEASURED",
    }
    write_json(DERIVED_DIR / "imagery" / "meta.json", meta)
    register_artifact(
        "imagery_basemap",
        {
            "files": [basemap["file"], "imagery/meta.json"],
            "data_state": "MEASURED",
            "source_id": "naip",
            "source": basemap["source"],
            "resolution": f"~{basemap['resolution_m']} m native",
            "method": "NAIP quads windowed to farm + margin, composited by alpha, Lanczos resample to 2048 px",
        },
    )
    register_artifact(
        "terrain_heightmap",
        {
            "files": [relative_to_derived(height["path"])],
            "data_state": "MEASURED",
            "source_id": "srtm",
            "source": "NASADEM HGT 1 arc-second (SRTM reprocessed)",
            "resolution": f"{height['info']['resolution_m']} m",
            "method": "bilinear resample of the DEM onto the common farm+margin grid",
        },
    )


if __name__ == "__main__":
    build()
