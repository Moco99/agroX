"""Pure NDVI maths for Sentinel-2 L2A bands: reflectance scaling, SCL cloud mask, zonal statistics, colour ramp.

No I/O: rasters arrive as numpy arrays. The same functions serve the pipeline (batch) and the
on-demand imagery endpoint, so a number never depends on which path produced it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]
BoolArray = NDArray[np.bool_]
RgbaArray = NDArray[np.uint8]

# L2A offset starts at processing baseline 04.00; earlier products carry no offset.
S2_BOA_OFFSET = -1000.0
S2_BASELINE_04_FROM = "20220125"
S2_SCALE = 10000.0
# SCL classes kept as clear-sky land: 4 vegetation, 5 not vegetated, 6 water (negative NDVI renders as no-data grey)
SCL_KEEP: tuple[int, ...] = (4, 5, 6)
# Zonal stats below this valid fraction are not published (cloud-contaminated means mislead the comparison)
MIN_VALID_FRACTION = 0.30
# Farm valid fraction at or above this counts as a cloud-free scene in the API
CLOUD_FREE_FRACTION = 0.95

# Canonical ramp, mirror of docs/07-design/design-tokens.md (the frontend reads the same stops)
NDVI_STOPS: tuple[float, ...] = (0.20, 0.35, 0.50, 0.65, 0.80)
NDVI_COLORS: tuple[tuple[int, int, int], ...] = (
    (0xDC, 0x34, 0x2E),
    (0xF1, 0x97, 0x28),
    (0xF0, 0xE5, 0x33),
    (0x6F, 0xBE, 0x30),
    (0x31, 0x9D, 0x34),
)
NDVI_NODATA_RGB = (0x4B, 0x55, 0x63)
ALPHA_VALID = 200
ALPHA_MASKED = 110


@dataclass(frozen=True)
class ZoneStats:
    mean: float | None
    p10: float | None
    p90: float | None
    valid_fraction: float
    n_pixels: int


def s2_offset(scene_id: str) -> float:
    generated = scene_id.rsplit("_", 1)[1][:8]
    return S2_BOA_OFFSET if generated >= S2_BASELINE_04_FROM else 0.0


def compute_ndvi(
    red_dn: FloatArray, nir_dn: FloatArray, scl: NDArray[np.integer], offset: float = S2_BOA_OFFSET
) -> tuple[FloatArray, BoolArray]:
    """NDVI = (NIR-RED)/(NIR+RED) on BOA reflectance; pixels outside SCL_KEEP or with zero DN become NaN."""
    red = (red_dn + offset) / S2_SCALE
    nir = (nir_dn + offset) / S2_SCALE
    denom = nir + red
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = np.where(denom != 0, (nir - red) / denom, np.nan)
    valid = np.isin(scl, SCL_KEEP) & (red_dn > 0) & (nir_dn > 0) & np.isfinite(ndvi)
    return np.where(valid, np.clip(ndvi, -1.0, 1.0), np.nan), valid


def zone_stats(ndvi: FloatArray, valid: BoolArray, mask: BoolArray) -> ZoneStats:
    """Mean, p10, p90 and valid fraction over the pixels inside one zone mask."""
    total = int(mask.sum())
    if total == 0:
        return ZoneStats(None, None, None, 0.0, 0)
    vals = ndvi[mask & valid]
    fraction = float(vals.size) / total
    if vals.size == 0:
        return ZoneStats(None, None, None, round(fraction, 3), 0)
    return ZoneStats(
        mean=round(float(np.mean(vals)), 4),
        p10=round(float(np.percentile(vals, 10)), 4),
        p90=round(float(np.percentile(vals, 90)), 4),
        valid_fraction=round(fraction, 3),
        n_pixels=int(vals.size),
    )


def colorize_ndvi(ndvi: FloatArray) -> RgbaArray:
    """RGBA image with the canonical ramp; masked pixels are grey at lower opacity, negative NDVI is no-data grey."""
    finite = np.isfinite(ndvi)
    safe = np.where(finite, ndvi, 0.0)
    rgba = np.zeros((*ndvi.shape, 4), dtype=np.uint8)
    for ch in range(3):
        channel = np.interp(safe, NDVI_STOPS, [c[ch] for c in NDVI_COLORS])
        channel = np.where(safe < 0, NDVI_NODATA_RGB[ch], channel)
        channel = np.where(finite, channel, NDVI_NODATA_RGB[ch])
        rgba[..., ch] = np.rint(channel).astype(np.uint8)
    rgba[..., 3] = np.where(finite, ALPHA_VALID, ALPHA_MASKED).astype(np.uint8)
    return rgba
