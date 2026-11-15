"""Choose the pilot farm from CDL 2021-2024 and write derived/parcel/<farm_id>.geojson.

Selection rule (deterministic, documented in decisions.md): slide a 40 x 40 pixel
window (1.2 km, ~144 ha) over the scraper bbox in the CDL grid (EPSG:5070, 30 m),
keep windows whose 2x2 quadrants contain both corn and soybean as 2024 majority,
and pick the one maximising the minimum quadrant purity (tie-break: share of
corn/soy pixels over the four years). Each quadrant becomes a management zone.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds

from pipeline.common import (
    CDL_CODES,
    DERIVED_DIR,
    FARM_ID,
    PILOT_BBOX,
    RAW_DIR,
    register_artifact,
    relative_to_derived,
    sha256_of,
    write_json,
)

CDL_YEARS = [2021, 2022, 2023, 2024]
WINDOW_PX = 40
STEP_PX = 2
# ~330 m margin so every clipped raster (MODIS, Sentinel-2) fully covers the farm
BBOX_MARGIN_DEG = 0.003
SRTM_PATH = RAW_DIR / "srtm" / "NASADEM_HGT_n42w094_elevation.tif"
DEM_NODATA = -32768
CORN, SOY = 1, 5

# Zone naming: quadrant order NW, NE, SW, SE (row-major in the raster)
ZONE_SPEC = [
    ("zone_nw", "Zona Noroeste", 0, 0),
    ("zone_ne", "Zona Noreste", 0, 1),
    ("zone_sw", "Zona Suroeste", 1, 0),
    ("zone_se", "Zona Sureste", 1, 1),
]


def _cdl_path(year: int):  # noqa: ANN202
    return RAW_DIR / "cdl" / f"CDL_{year}_19169.tif"


# ─────────────────────────────────────────
# Section: Raster loading
# ─────────────────────────────────────────


def load_cdl_stack() -> tuple[np.ndarray, Any, str]:
    """Stack the four CDL years cropped to the bbox; returns (array[year,row,col], transform, crs)."""
    with rasterio.open(_cdl_path(CDL_YEARS[0])) as ref:
        crs = ref.crs.to_string()
        to_cdl = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        corners = [
            to_cdl.transform(PILOT_BBOX[0], PILOT_BBOX[1]),
            to_cdl.transform(PILOT_BBOX[2], PILOT_BBOX[1]),
            to_cdl.transform(PILOT_BBOX[2], PILOT_BBOX[3]),
            to_cdl.transform(PILOT_BBOX[0], PILOT_BBOX[3]),
        ]
        xs, ys = zip(*corners, strict=True)
        bounds = (min(xs), min(ys), max(xs), max(ys))
        window = from_bounds(*bounds, transform=ref.transform).round_offsets().round_lengths()
        transform = ref.window_transform(window)
    arrays = []
    for year in CDL_YEARS:
        with rasterio.open(_cdl_path(year)) as src:
            arrays.append(src.read(1, window=window))
    return np.stack(arrays), transform, crs


# ─────────────────────────────────────────
# Section: Farm selection
# ─────────────────────────────────────────


def majority(block: np.ndarray) -> tuple[int, float]:
    values, counts = np.unique(block, return_counts=True)
    idx = int(np.argmax(counts))
    return int(values[idx]), float(counts[idx] / block.size)


def load_dem_mask() -> tuple[np.ndarray, Any]:
    """Valid-data mask of the NASADEM tile: the n42w094 tile only covers lat >= 42 N, so the farm must sit there."""
    with rasterio.open(SRTM_PATH) as src:
        data = src.read(1)
        return data != DEM_NODATA, src.transform


def coverage_ok(transform: Any, to_wgs: Transformer, r: int, c: int, dem_mask: np.ndarray, dem_transform: Any) -> bool:
    """Farm must be inside the bbox (with a margin) and on valid DEM pixels (corners + centre)."""
    ring = pixel_polygon(transform, r, c, r + WINDOW_PX, c + WINDOW_PX, to_wgs)
    lon0, lat0, lon1, lat1 = PILOT_BBOX
    if not all(
        lon0 + BBOX_MARGIN_DEG <= lon <= lon1 - BBOX_MARGIN_DEG
        and lat0 + BBOX_MARGIN_DEG <= lat <= lat1 - BBOX_MARGIN_DEG
        for lon, lat in ring
    ):
        return False
    centre = [float(np.mean([p[0] for p in ring[:4]])), float(np.mean([p[1] for p in ring[:4]]))]
    for lon, lat in [*ring[:4], centre]:
        row, col = rasterio.transform.rowcol(dem_transform, lon, lat)
        if not (0 <= row < dem_mask.shape[0] and 0 <= col < dem_mask.shape[1]) or not dem_mask[row, col]:
            return False
    return True


def select_window(stack: np.ndarray, transform: Any, to_wgs: Transformer) -> tuple[int, int, float]:
    """Return (row0, col0, score) of the best window per the documented rule."""
    corn_soy_all_years = np.isin(stack, [CORN, SOY]).all(axis=0)
    latest = stack[-1]
    half = WINDOW_PX // 2
    dem_mask, dem_transform = load_dem_mask()
    best: tuple[float, float, int, int] | None = None
    for r in range(0, stack.shape[1] - WINDOW_PX + 1, STEP_PX):
        for c in range(0, stack.shape[2] - WINDOW_PX + 1, STEP_PX):
            if not coverage_ok(transform, to_wgs, r, c, dem_mask, dem_transform):
                continue
            quadrants = [
                latest[r + qr * half : r + (qr + 1) * half, c + qc * half : c + (qc + 1) * half]
                for qr in (0, 1)
                for qc in (0, 1)
            ]
            majors = [majority(q) for q in quadrants]
            crops = {m[0] for m in majors}
            if not ({CORN, SOY} <= crops) or not crops <= {CORN, SOY}:
                continue
            min_purity = min(m[1] for m in majors)
            share = float(corn_soy_all_years[r : r + WINDOW_PX, c : c + WINDOW_PX].mean())
            key = (min_purity, share, r, c)
            if best is None or key[:2] > best[:2]:
                best = key
    if best is None:
        raise RuntimeError("no window with mixed corn/soy quadrants found")
    return best[2], best[3], best[0]


# ─────────────────────────────────────────
# Section: GeoJSON assembly
# ─────────────────────────────────────────


def pixel_polygon(transform: Any, r0: int, c0: int, r1: int, c1: int, to_wgs: Transformer) -> list[list[float]]:
    """Polygon ring (lon, lat) of the pixel block [r0:r1, c0:c1]."""
    corners_rc = [(r0, c0), (r0, c1), (r1, c1), (r1, c0), (r0, c0)]
    ring = []
    for r, c in corners_rc:
        x, y = transform * (c, r)
        lon, lat = to_wgs.transform(x, y)
        ring.append([round(lon, 6), round(lat, 6)])
    return ring


def build() -> None:
    stack, transform, crs = load_cdl_stack()
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    r0, c0, score = select_window(stack, transform, to_wgs)
    half = WINDOW_PX // 2
    pixel_area_ha = abs(transform.a * transform.e) / 10_000.0

    features: list[dict[str, Any]] = []
    farm_ring = pixel_polygon(transform, r0, c0, r0 + WINDOW_PX, c0 + WINDOW_PX, to_wgs)
    zone_summaries = []
    for zone_id, name_es, qr, qc in ZONE_SPEC:
        rr0, cc0 = r0 + qr * half, c0 + qc * half
        rr1, cc1 = rr0 + half, cc0 + half
        block = stack[:, rr0:rr1, cc0:cc1]
        history = []
        for i, year in enumerate(CDL_YEARS):
            code, purity = majority(block[i])
            history.append(
                {
                    "year": year,
                    "cdl_code": code,
                    "crop_id": CDL_CODES.get(code, f"cdl_{code}"),
                    "purity": round(purity, 3),
                }
            )
        crop_2024 = history[-1]["crop_id"]
        area_ha = round(half * half * pixel_area_ha, 2)
        ring = pixel_polygon(transform, rr0, cc0, rr1, cc1, to_wgs)
        lon_c = float(np.mean([p[0] for p in ring[:4]]))
        lat_c = float(np.mean([p[1] for p in ring[:4]]))
        props = {
            "zone_id": zone_id,
            "name_es": name_es,
            "crop_id": crop_2024,
            "crop_purity_2024": history[-1]["purity"],
            "area_ha": area_ha,
            "centroid": {"lat": round(lat_c, 6), "lon": round(lon_c, 6)},
            "cdl_history": history,
            "data_state": "MEASURED",
            "source": "USDA NASS Cropland Data Layer 30 m, county 19169, years 2021-2024",
        }
        features.append(
            {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}
        )
        zone_summaries.append({"zone_id": zone_id, "crop_id": crop_2024, "area_ha": area_ha})

    farm_props = {
        "farm_id": FARM_ID,
        "name_es": "Granja piloto Story County",
        "feature_kind": "farm",
        "area_ha": round(WINDOW_PX * WINDOW_PX * pixel_area_ha, 2),
        "centroid": {
            "lat": round(float(np.mean([p[1] for p in farm_ring[:4]])), 6),
            "lon": round(float(np.mean([p[0] for p in farm_ring[:4]])), 6),
        },
        "selection": {
            "method": "40x40 px CDL window maximising min quadrant purity with mixed corn/soy 2024 majorities, "
            "inside the bbox margin and on valid NASADEM pixels (tile covers lat >= 42 N only)",
            "window_px": WINDOW_PX,
            "min_quadrant_purity": round(score, 3),
            "cdl_crs": crs,
            "window_origin_rc": [int(r0), int(c0)],
        },
        "data_state": "DECLARED",
    }
    farm_feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [farm_ring]},
        "properties": farm_props,
    }
    for f in features:
        f["properties"]["feature_kind"] = "zone"
    collection = {"type": "FeatureCollection", "farm_id": FARM_ID, "features": [farm_feature, *features]}

    out_path = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
    write_json(out_path, collection)
    register_artifact(
        "parcel_farm",
        {
            "files": [relative_to_derived(out_path)],
            "data_state": "MEASURED",
            "source_id": "cdl",
            "resolution": "30 m",
            "years": CDL_YEARS,
            "zones": zone_summaries,
            "inputs": [
                {"path": f"data/raw/cdl/CDL_{y}_19169.tif", "sha256": sha256_of(_cdl_path(y))} for y in CDL_YEARS
            ],
        },
    )
    print(f"[parcel] farm window r={r0} c={c0} min_purity={score:.3f} zones={zone_summaries}")


if __name__ == "__main__":
    build()
