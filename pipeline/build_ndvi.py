"""NDVI observations per zone: MODIS MOD/MYD13Q1 (250 m, 16-day) and Sentinel-2 L2A (10 m, SCL mask).

Outputs (derived/obs/):
  ndvi_modis_<farm>.csv      date, zone_id, ndvi, n_pixels, product, qa_flag
  ndvi_s2_<farm>.csv         date, zone_id, ndvi, ndvi_p10, ndvi_p90, valid_fraction, n_pixels (full season)
  ndvi_s2_<farm>.meta.json   per-date scene id, farm valid fraction, cloud_free flag, PNG path, common bounds
  ndvi_s2_overlay_<farm>.png/.json  legacy single overlay (cleanest scene) for /api/observations/ndvi-overlay
  ../imagery/ndvi/<date>.png coloured NDVI (canonical ramp) per useful date on the common farm+margin grid

Sentinel-2 inputs come from the ObjectStore (S3 windowed reads when AGROX_S3_BUCKET is set, else data/raw).

MODIS scale factor 0.0001 and fill -3000 follow the product spec. Sentinel-2 L2A
DN use the BOA offset (-1000) introduced with processing baseline 04.00 (2022-01);
all scenes here are 2024 so the offset is applied and recorded in the metadata.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import geometry_mask
from shapely.geometry import Point, Polygon

from app.engine.ndvi import (
    CLOUD_FREE_FRACTION,
    MIN_VALID_FRACTION,
    S2_BASELINE_04_FROM,
    S2_BOA_OFFSET,
    S2_SCALE,
    SCL_KEEP,
    colorize_ndvi,
    zone_stats,
)
from app.engine.ndvi import s2_offset as s2_offset
from app.providers.imagery.rasters import Grid, list_s2_scenes, read_scene_ndvi, s2_grid
from app.storage.factory import get_store
from pipeline.common import (
    DERIVED_DIR,
    FARM_ID,
    RAW_DIR,
    farm_area_bounds,
    register_artifact,
    relative_to_derived,
    write_json,
)

MODIS_DIR = RAW_DIR / "modis_ndvi"
PARCEL_PATH = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
MODIS_SCALE = 0.0001
MODIS_FILL = -3000


def load_zones() -> list[tuple[str, Polygon]]:
    parcel = json.loads(PARCEL_PATH.read_text())
    return [
        (f["properties"]["zone_id"], Polygon(f["geometry"]["coordinates"][0]))
        for f in parcel["features"]
        if f["properties"]["feature_kind"] == "zone"
    ]


def farm_bounds() -> tuple[float, float, float, float]:
    parcel = json.loads(PARCEL_PATH.read_text())
    farm = next(f for f in parcel["features"] if f["properties"]["feature_kind"] == "farm")
    ring = farm["geometry"]["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def pixel_centres(src: rasterio.DatasetReader) -> tuple[np.ndarray, np.ndarray]:
    rows, cols = np.indices(src.shape)
    xs, ys = rasterio.transform.xy(src.transform, rows.ravel(), cols.ravel(), offset="center")
    return np.array(xs).reshape(src.shape), np.array(ys).reshape(src.shape)


def zone_masks(src: rasterio.DatasetReader, zones: list[tuple[str, Polygon]]) -> dict[str, np.ndarray]:
    """Boolean mask per zone of pixels whose centre falls inside the zone polygon."""
    xs, ys = pixel_centres(src)
    masks = {}
    for zid, poly in zones:
        minx, miny, maxx, maxy = poly.bounds
        cand = (xs >= minx) & (xs <= maxx) & (ys >= miny) & (ys <= maxy)
        m = np.zeros(src.shape, dtype=bool)
        for r, c in zip(*np.nonzero(cand), strict=True):
            if poly.contains(Point(xs[r, c], ys[r, c])):
                m[r, c] = True
        masks[zid] = m
    return masks


# ─────────────────────────────────────────
# Section: MODIS
# ─────────────────────────────────────────


def modis_date(name: str) -> tuple[str, str]:
    m = re.match(r"(M[OY]D13Q1)\.A(\d{4})(\d{3})\.", name)
    if not m:
        raise ValueError(name)
    product, year, doy = m.group(1), int(m.group(2)), int(m.group(3))
    # Composite period starts on the DOY in the file name; we stamp the composite start date
    return product, (datetime(year, 1, 1) + timedelta(days=doy - 1)).strftime("%Y-%m-%d")


def build_modis(zones: list[tuple[str, Polygon]]) -> tuple[Path, dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    files = sorted(MODIS_DIR.glob("*.tif"))
    masks: dict[str, np.ndarray] | None = None
    nearest: dict[str, tuple[int, int]] = {}
    for path in files:
        product, date = modis_date(path.name)
        with rasterio.open(path) as src:
            data = src.read(1).astype(float)
            if masks is None:
                masks = zone_masks(src, zones)
                xs, ys = pixel_centres(src)
                for zid, poly in zones:
                    cx, cy = poly.centroid.x, poly.centroid.y
                    d = (xs - cx) ** 2 + (ys - cy) ** 2
                    nearest[zid] = tuple(int(v) for v in np.unravel_index(int(np.argmin(d)), d.shape))  # type: ignore[assignment]
        valid = data != MODIS_FILL
        ndvi = np.where(valid, data * MODIS_SCALE, np.nan)
        for zid, _ in zones:
            m = masks[zid]
            vals = ndvi[m & valid]
            flag = "no_qa_layer"
            if vals.size == 0:
                r, c = nearest[zid]
                vals = ndvi[r : r + 1, c : c + 1][valid[r : r + 1, c : c + 1]]
                flag = "no_qa_layer;nearest_pixel"
            if vals.size == 0:
                continue
            rows.append(
                {
                    "date": date,
                    "zone_id": zid,
                    "ndvi": round(float(np.nanmean(vals)), 4),
                    "n_pixels": int(vals.size),
                    "product": product,
                    "qa_flag": flag,
                }
            )
    rows.sort(key=lambda r: (r["date"], r["zone_id"]))
    # Terra and Aqua can share a composite start date; keep both rows but the CSV is sorted and the backend averages
    out_path = DERIVED_DIR / "obs" / f"ndvi_modis_{FARM_ID}.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as fh:
        fh.write("date,zone_id,ndvi,n_pixels,product,qa_flag\n")
        for r in rows:
            fh.write(f"{r['date']},{r['zone_id']},{r['ndvi']},{r['n_pixels']},{r['product']},{r['qa_flag']}\n")
    dates = sorted({r["date"] for r in rows})
    meta = {
        "files": [relative_to_derived(out_path)],
        "data_state": "MEASURED",
        "source_id": "modis_ndvi",
        "source": "MODIS MOD13Q1 + MYD13Q1 v061 NDVI 250 m 16-day (Planetary Computer subset)",
        "resolution": "250 m",
        "period": {"start": dates[0], "end": dates[-1], "composites": len(dates)},
        "method": "scale 0.0001, fill -3000 dropped; mean of pixel centres inside zone, nearest pixel fallback;"
        " no pixel-reliability layer downloaded (qa_flag=no_qa_layer)",
        "scenes": len(files),
    }
    print(f"[ndvi] MODIS rows={len(rows)} composites={len(dates)} {dates[0]}..{dates[-1]}")
    return out_path, meta


# ─────────────────────────────────────────
# Section: Sentinel-2 (season series from the ObjectStore: S3 on demand or data/raw)
# ─────────────────────────────────────────

S2_META_PATH = DERIVED_DIR / "obs" / f"ndvi_s2_{FARM_ID}.meta.json"
NDVI_PNG_DIR = DERIVED_DIR / "imagery" / "ndvi"
# Scenes with at least this farm valid fraction get a pre-rendered PNG; the rest are rendered on demand
PNG_MIN_FARM_VALID = 0.5
# 2023-2024 scraper range; scenes outside the pilot season are kept in the CSV for completeness
SEASON_START = "2024-04-01"


def _farm_polygon() -> Polygon:
    parcel = json.loads(PARCEL_PATH.read_text())
    farm = next(f for f in parcel["features"] if f["properties"]["feature_kind"] == "farm")
    return Polygon(farm["geometry"]["coordinates"][0])


def _polygon_mask(poly: Polygon, grid: Grid) -> np.ndarray:
    # all_touched=False keeps pixel-centre semantics, like the MODIS zonal mean above
    return geometry_mask(
        [poly.__geo_interface__], out_shape=(grid.height, grid.width), transform=grid.transform, invert=True
    )


def build_s2(zones: list[tuple[str, Polygon]]) -> tuple[list[Path], dict[str, Any]]:
    store = get_store()
    scenes = list_s2_scenes(store)
    if not scenes:
        raise RuntimeError("no Sentinel-2 scenes found in the active store")
    source_mode = store.mode
    previous = json.loads(S2_META_PATH.read_text()) if S2_META_PATH.exists() else {}
    prev_dates = len(previous.get("dates", []))
    n_dates = len({s.date for s in scenes})
    # A local data/raw with only the last scenes must not overwrite a full-season series built from S3
    if n_dates < prev_dates and os.environ.get("AGROX_FORCE_S2") != "1":
        print(f"[ndvi] S2 skipped: store has {n_dates} dates < existing {prev_dates} (AGROX_FORCE_S2=1 to override)")
        return [], {}

    bounds = farm_area_bounds()
    grid = s2_grid(store, scenes[0], bounds)
    masks = {zid: _polygon_mask(poly, grid) for zid, poly in zones}
    farm_mask = _polygon_mask(_farm_polygon(), grid)

    # One scene per date: duplicates (same acquisition, reprocessed) keep the one with more valid farm pixels
    best: dict[str, dict[str, Any]] = {}
    for scene in scenes:
        ndvi, valid = read_scene_ndvi(store, scene, grid)
        farm_valid = float(valid[farm_mask].mean())
        entry = {
            "scene": scene,
            "ndvi": ndvi,
            "valid": valid,
            "farm_valid": farm_valid,
            "area_valid": float(valid.mean()),
        }
        current = best.get(scene.date)
        if current is None or farm_valid >= current["farm_valid"]:
            best[scene.date] = entry
        print(f"[ndvi] {scene.date} {scene.scene_id[-15:]} farm_valid={farm_valid:.2f}")

    rows: list[dict[str, Any]] = []
    dates_meta: list[dict[str, Any]] = []
    NDVI_PNG_DIR.mkdir(parents=True, exist_ok=True)
    for old in NDVI_PNG_DIR.glob("*.png"):
        old.unlink()
    for date in sorted(best):
        e = best[date]
        zone_vals: list[float] = []
        for zid, _ in zones:
            st = zone_stats(e["ndvi"], e["valid"], masks[zid])
            publish = st.mean is not None and st.valid_fraction >= MIN_VALID_FRACTION
            if publish and st.mean is not None:
                zone_vals.append(st.mean)
            rows.append(
                {
                    "date": date,
                    "zone_id": zid,
                    "ndvi": st.mean if publish else None,
                    "ndvi_p10": st.p10 if publish else None,
                    "ndvi_p90": st.p90 if publish else None,
                    "valid_fraction": st.valid_fraction,
                    "n_pixels": st.n_pixels,
                }
            )
        png_rel = None
        if e["farm_valid"] >= PNG_MIN_FARM_VALID:
            png_path = NDVI_PNG_DIR / f"{date}.png"
            Image.fromarray(colorize_ndvi(e["ndvi"]), "RGBA").save(png_path, optimize=True)
            png_rel = relative_to_derived(png_path)
        dates_meta.append(
            {
                "date": date,
                "scene_id": e["scene"].scene_id,
                "farm_valid_fraction": round(e["farm_valid"], 3),
                "area_valid_fraction": round(e["area_valid"], 3),
                "cloud_free": e["farm_valid"] >= CLOUD_FREE_FRACTION,
                "farm_ndvi_mean": round(float(np.mean(zone_vals)), 4) if zone_vals else None,
                "png": png_rel,
            }
        )

    out_csv = DERIVED_DIR / "obs" / f"ndvi_s2_{FARM_ID}.csv"
    with out_csv.open("w") as fh:
        fh.write("date,zone_id,ndvi,ndvi_p10,ndvi_p90,valid_fraction,n_pixels\n")
        for r in rows:
            cells = ["" if r[k] is None else r[k] for k in ("ndvi", "ndvi_p10", "ndvi_p90")]
            fh.write(
                f"{r['date']},{r['zone_id']},{cells[0]},{cells[1]},{cells[2]},{r['valid_fraction']},{r['n_pixels']}\n"
            )

    # Legacy single overlay (/api/observations/ndvi-overlay): the cloud-free-est scene of the season
    pilot_dates = [d for d in dates_meta if d["date"] >= SEASON_START]
    top = max(pilot_dates or dates_meta, key=lambda d: (d["farm_valid_fraction"], d["date"]))
    top_e = best[top["date"]]
    west, south, east, north = grid.bounds
    png_path = DERIVED_DIR / "obs" / f"ndvi_s2_overlay_{FARM_ID}.png"
    Image.fromarray(colorize_ndvi(top_e["ndvi"]), "RGBA").save(png_path, optimize=True)
    overlay_meta = {
        "farm_id": FARM_ID,
        "scene_id": top["scene_id"],
        "date": top["date"],
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "width_px": grid.width,
        "height_px": grid.height,
        "resolution_m": 10,
        "source": "Sentinel-2 L2A (ESA, via Planetary Computer), NDVI from B04/B08 with SCL mask",
        "data_state": "MEASURED",
        "valid_fraction_farm": top["farm_valid_fraction"],
        "ramp": "design-tokens NDVI ramp; alpha 200 valid / 110 masked (grey)",
    }
    json_path = DERIVED_DIR / "obs" / f"ndvi_s2_overlay_{FARM_ID}.json"
    write_json(json_path, overlay_meta)

    first, last = dates_meta[0]["date"], dates_meta[-1]["date"]
    meta = {
        "files": [relative_to_derived(p) for p in (out_csv, png_path, json_path, S2_META_PATH)],
        "data_state": "MEASURED",
        "source_id": "sentinel2",
        "source": "Sentinel-2 L2A (ESA, via Planetary Computer), tile T15TVG, B04/B08/SCL clipped to the area",
        "resolution": "10 m (SCL 20 m)",
        "period": {"start": first, "end": last},
        "method": f"NDVI=(B08-B04)/(B08+B04) after per-product BOA offset {S2_BOA_OFFSET:+.0f} "
        f"from {S2_BASELINE_04_FROM}, zero before; scale 1/{S2_SCALE:.0f}; "
        f"SCL keep {list(SCL_KEEP)}; per zone mean/p10/p90 over pixel centres; zone NDVI published only when "
        f"valid fraction >= {MIN_VALID_FRACTION}; one scene per date (most valid farm pixels)",
        "overlay_scene": top["scene_id"],
        "scenes": len(scenes),
        "dates": len(dates_meta),
        "input_mode": source_mode,
    }
    area_meta = {
        "farm_id": FARM_ID,
        "bounds_wgs84": list(grid.bounds),
        "grid": {"width": grid.width, "height": grid.height},
        "data_state": "MEASURED",
        "min_valid_fraction": MIN_VALID_FRACTION,
        "cloud_free_fraction": CLOUD_FREE_FRACTION,
        "dates": dates_meta,
    }
    write_json(S2_META_PATH, area_meta)
    print(f"[ndvi] S2 scenes={len(scenes)} dates={len(dates_meta)} pngs={sum(1 for d in dates_meta if d['png'])}")
    return [out_csv, png_path, json_path], meta


def build() -> None:
    zones = load_zones()
    _, modis_meta = build_modis(zones)
    register_artifact("obs_ndvi_modis", modis_meta)
    _, s2_meta = build_s2(zones)
    if s2_meta:
        register_artifact("obs_ndvi_sentinel2", s2_meta)


if __name__ == "__main__":
    build()
