"""Slope per management zone from NASADEM (SRTM) elevation -> derived/terrain/<farm_id>.json.

Slope is computed with a central-difference gradient on the 1 arc-second grid,
with pixel sizes converted to metres at the farm latitude. Mean/max slope per zone
feed the engine's erosion *index* (a product classification, not a USLE run).
"""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import uniform_filter

from pipeline.common import DERIVED_DIR, FARM_ID, RAW_DIR, register_artifact, relative_to_derived, sha256_of, write_json

SRTM_PATH = RAW_DIR / "srtm" / "NASADEM_HGT_n42w094_elevation.tif"
PARCEL_PATH = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
DEM_NODATA = -32768


def zone_bounds(ring: list[list[float]]) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def build() -> None:
    parcel = json.loads(PARCEL_PATH.read_text())
    zones = [f for f in parcel["features"] if f["properties"]["feature_kind"] == "zone"]
    out = {
        "farm_id": FARM_ID,
        "zones": [],
        "source": "NASADEM HGT 1 arc-second (SRTM reprocessed)",
        "data_state": "MEASURED",
        "method": "3x3 mean smoothing, central-difference gradient, slope % = 100*sqrt(dz/dx^2+dz/dy^2)",
        "note": "NASADEM vertical noise still inflates slope on flat terrain; use as a relative index.",
    }
    with rasterio.open(SRTM_PATH) as src:
        for feature in zones:
            ring = feature["geometry"]["coordinates"][0]
            lon0, lat0, lon1, lat1 = zone_bounds(ring)
            # One pixel of padding keeps the gradient valid at the zone edge
            pad = abs(src.res[0])
            win = from_bounds(lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad, transform=src.transform)
            win = win.round_offsets().round_lengths()
            raw = src.read(1, window=win)
            nodata_fraction = float((raw == DEM_NODATA).mean())
            if nodata_fraction > 0:
                out["zones"].append(
                    {
                        "zone_id": feature["properties"]["zone_id"],
                        "data_state": "ESTIMATED",
                        "warnings": [f"DEM nodata over {nodata_fraction:.0%} of the zone"],
                        "slope_mean_pct": None,
                        "slope_max_pct": None,
                        "elevation_mean_m": None,
                    }
                )
                continue
            elev = raw.astype(float)
            # 3x3 mean smoothing damps SRTM/NASADEM pixel noise (~1-2 m) that would inflate local slope
            elev = uniform_filter(elev, size=3, mode="nearest")
            lat_mid = (lat0 + lat1) / 2
            dy_m = abs(src.res[1]) * 111_320.0
            dx_m = abs(src.res[0]) * 111_320.0 * math.cos(math.radians(lat_mid))
            gy, gx = np.gradient(elev, dy_m, dx_m)
            slope_pct = 100.0 * np.sqrt(gx**2 + gy**2)
            inner = slope_pct[1:-1, 1:-1] if slope_pct.shape[0] > 2 and slope_pct.shape[1] > 2 else slope_pct
            inner_elev = elev[1:-1, 1:-1] if elev.shape[0] > 2 and elev.shape[1] > 2 else elev
            out["zones"].append(
                {
                    "zone_id": feature["properties"]["zone_id"],
                    "elevation_mean_m": round(float(inner_elev.mean()), 1),
                    "elevation_min_m": round(float(inner_elev.min()), 1),
                    "elevation_max_m": round(float(inner_elev.max()), 1),
                    "slope_mean_pct": round(float(inner.mean()), 2),
                    "slope_max_pct": round(float(inner.max()), 2),
                    "pixels": int(inner.size),
                    "data_state": "MEASURED",
                    "warnings": [],
                }
            )
    out_path = DERIVED_DIR / "terrain" / f"{FARM_ID}.json"
    write_json(out_path, out)
    register_artifact(
        "terrain_slope",
        {
            "files": [relative_to_derived(out_path)],
            "data_state": "MEASURED",
            "source_id": "srtm",
            "resolution": "1 arc-second (~30 m)",
            "inputs": [{"path": "data/raw/srtm/NASADEM_HGT_n42w094_elevation.tif", "sha256": sha256_of(SRTM_PATH)}],
        },
    )
    print(f"[terrain] {[(z['zone_id'], z['slope_mean_pct']) for z in out['zones']]}")


if __name__ == "__main__":
    build()
