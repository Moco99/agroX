"""NDVI observations per zone: MODIS MOD/MYD13Q1 (250 m, 16-day) and Sentinel-2 L2A (10 m, SCL mask).

Outputs (derived/obs/):
  ndvi_modis_<farm>.csv      date, zone_id, ndvi, n_pixels, product, qa_flag
  ndvi_s2_<farm>.csv         date, zone_id, ndvi, valid_fraction, n_pixels
  ndvi_s2_overlay_<farm>.png coloured NDVI (canonical ramp) around the farm
  ndvi_s2_overlay_<farm>.json bounds, resolution, date, scene

MODIS scale factor 0.0001 and fill -3000 follow the product spec. Sentinel-2 L2A
DN use the BOA offset (-1000) introduced with processing baseline 04.00 (2022-01);
all scenes here are 2024 so the offset is applied and recorded in the metadata.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from shapely.geometry import Point, Polygon

from pipeline.common import (
    DERIVED_DIR,
    FARM_ID,
    RAW_DIR,
    ndvi_to_rgb,
    register_artifact,
    relative_to_derived,
    write_json,
)

MODIS_DIR = RAW_DIR / "modis_ndvi"
S2_DIR = RAW_DIR / "sentinel2"
PARCEL_PATH = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
MODIS_SCALE = 0.0001
MODIS_FILL = -3000
S2_BOA_OFFSET = -1000.0
S2_SCALE = 10000.0
# SCL classes kept as clear-sky land: 4 vegetation, 5 not vegetated, 6 water (water NDVI < 0 shows as no-data colour)
SCL_KEEP = {4, 5, 6}
OVERLAY_MARGIN_DEG = 0.004


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
# Section: Sentinel-2
# ─────────────────────────────────────────


def s2_scenes() -> dict[str, dict[str, Path]]:
    scenes: dict[str, dict[str, Path]] = {}
    for path in S2_DIR.glob("*.tif"):
        m = re.match(r"(S2[AB]_MSIL2A_(\d{8})T\d{6}_R\d{3}_T\w{5}_\d{8}T\d{6})_(B04|B08|SCL)\.tif", path.name)
        if not m:
            continue
        scenes.setdefault(m.group(1), {})[m.group(3)] = path
    return {k: v for k, v in scenes.items() if {"B04", "B08", "SCL"} <= set(v)}


def s2_ndvi(scene: dict[str, Path]) -> tuple[np.ndarray, np.ndarray, Any, Any]:
    with (
        rasterio.open(scene["B04"]) as red_src,
        rasterio.open(scene["B08"]) as nir_src,
        rasterio.open(scene["SCL"]) as scl_src,
    ):
        red = red_src.read(1).astype(float)
        nir = nir_src.read(1).astype(float)
        scl = scl_src.read(1)
        transform = red_src.transform
        crs = red_src.crs
        # SCL is 20 m; resample by nearest neighbour onto the 10 m band grid
        ry = red.shape[0] / scl.shape[0]
        rx = red.shape[1] / scl.shape[1]
        rows = np.minimum((np.arange(red.shape[0]) / ry).astype(int), scl.shape[0] - 1)
        cols = np.minimum((np.arange(red.shape[1]) / rx).astype(int), scl.shape[1] - 1)
        scl_up = scl[rows][:, cols]
    red_r = (red + S2_BOA_OFFSET) / S2_SCALE
    nir_r = (nir + S2_BOA_OFFSET) / S2_SCALE
    denom = nir_r + red_r
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = np.where(denom != 0, (nir_r - red_r) / denom, np.nan)
    valid = np.isin(scl_up, list(SCL_KEEP)) & (red > 0) & (nir > 0)
    ndvi = np.where(valid, np.clip(ndvi, -1, 1), np.nan)
    return ndvi, valid, transform, crs


def build_s2(zones: list[tuple[str, Polygon]]) -> tuple[list[Path], dict[str, Any]]:
    scenes = s2_scenes()
    rows: list[dict[str, Any]] = []
    best_scene: tuple[float, str, np.ndarray, Any] | None = None
    masks: dict[str, np.ndarray] | None = None
    for scene_id in sorted(scenes):
        ndvi, valid, transform, crs = s2_ndvi(scenes[scene_id])
        date = re.search(r"_(\d{8})T", scene_id).group(1)  # type: ignore[union-attr]
        date_iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
        if masks is None:
            with rasterio.open(scenes[scene_id]["B04"]) as src:
                masks = zone_masks(src, zones)
        farm_valid = 0.0
        for zid, _ in zones:
            m = masks[zid]
            vf = float(valid[m].mean()) if m.any() else 0.0
            farm_valid += vf / len(zones)
            vals = ndvi[m & valid]
            rows.append(
                {
                    "date": date_iso,
                    "zone_id": zid,
                    "ndvi": round(float(np.nanmean(vals)), 4) if vals.size else None,
                    "valid_fraction": round(vf, 3),
                    "n_pixels": int(vals.size),
                }
            )
        if best_scene is None or farm_valid > best_scene[0]:
            best_scene = (farm_valid, scene_id, ndvi, transform)
    rows.sort(key=lambda r: (r["date"], r["zone_id"]))
    out_csv = DERIVED_DIR / "obs" / f"ndvi_s2_{FARM_ID}.csv"
    with out_csv.open("w") as fh:
        fh.write("date,zone_id,ndvi,valid_fraction,n_pixels\n")
        for r in rows:
            nd = "" if r["ndvi"] is None else r["ndvi"]
            fh.write(f"{r['date']},{r['zone_id']},{nd},{r['valid_fraction']},{r['n_pixels']}\n")

    assert best_scene is not None
    _, scene_id, ndvi, transform = best_scene
    lon0, lat0, lon1, lat1 = farm_bounds()
    lon0 -= OVERLAY_MARGIN_DEG
    lon1 += OVERLAY_MARGIN_DEG
    lat0 -= OVERLAY_MARGIN_DEG
    lat1 += OVERLAY_MARGIN_DEG
    r0, c0 = rasterio.transform.rowcol(transform, lon0, lat1)
    r1, c1 = rasterio.transform.rowcol(transform, lon1, lat0)
    r0, c0 = max(int(r0), 0), max(int(c0), 0)
    r1, c1 = min(int(r1), ndvi.shape[0]), min(int(c1), ndvi.shape[1])
    crop = ndvi[r0:r1, c0:c1]
    rgba = np.zeros((*crop.shape, 4), dtype=np.uint8)
    for i in range(crop.shape[0]):
        for j in range(crop.shape[1]):
            v = crop[i, j]
            rgb = ndvi_to_rgb(v)
            rgba[i, j, :3] = rgb
            rgba[i, j, 3] = 200 if v == v else 110
    png_path = DERIVED_DIR / "obs" / f"ndvi_s2_overlay_{FARM_ID}.png"
    Image.fromarray(rgba, "RGBA").save(png_path, optimize=True)
    west, north = rasterio.transform.xy(transform, r0, c0, offset="ul")
    east, south = rasterio.transform.xy(transform, r1, c1, offset="ul")
    date = re.search(r"_(\d{8})T", scene_id).group(1)  # type: ignore[union-attr]
    overlay_meta = {
        "farm_id": FARM_ID,
        "scene_id": scene_id,
        "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
        "bounds": {"west": float(west), "south": float(south), "east": float(east), "north": float(north)},
        "width_px": int(crop.shape[1]),
        "height_px": int(crop.shape[0]),
        "resolution_m": 10,
        "source": "Sentinel-2 L2A (ESA, via Planetary Computer), NDVI from B04/B08 with SCL mask",
        "data_state": "MEASURED",
        "valid_fraction_farm": round(best_scene[0], 3),
        "ramp": "design-tokens NDVI ramp; alpha 200 valid / 110 masked (grey)",
    }
    json_path = DERIVED_DIR / "obs" / f"ndvi_s2_overlay_{FARM_ID}.json"
    write_json(json_path, overlay_meta)
    dates = sorted({r["date"] for r in rows})
    meta = {
        "files": [relative_to_derived(p) for p in (out_csv, png_path, json_path)],
        "data_state": "MEASURED",
        "source_id": "sentinel2",
        "resolution": "10 m (SCL 20 m)",
        "period": {"start": dates[0], "end": dates[-1]},
        "method": f"NDVI=(B08-B04)/(B08+B04) after BOA offset {S2_BOA_OFFSET:+.0f} and scale 1/{S2_SCALE:.0f}; "
        f"SCL keep {sorted(SCL_KEEP)}; zone mean over pixel centres; overlay from scene with best valid fraction",
        "overlay_scene": scene_id,
        "scenes": len(scenes),
        "coverage_note": "Only end-of-season scenes (2024-08-31..2024-09-30) exist: the scraper fetched the last 6 "
        "items of the range (data-pipeline debt a).",
    }
    print(f"[ndvi] S2 scenes={len(scenes)} overlay={scene_id} valid={best_scene[0]:.2f} size={crop.shape}")
    return [out_csv, png_path, json_path], meta


def build() -> None:
    zones = load_zones()
    _, modis_meta = build_modis(zones)
    register_artifact("obs_ndvi_modis", modis_meta)
    _, s2_meta = build_s2(zones)
    register_artifact("obs_ndvi_sentinel2", s2_meta)


if __name__ == "__main__":
    build()
