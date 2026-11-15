"""Pure raster maths for the imagery of point farms: true-colour composite and heightmap statistics.

No I/O: scenes arrive as numpy arrays already cropped to one output grid. The colour itself is ESA's
Sentinel-2 L2A TCI product (8-bit true colour shipped with every scene), so no stretch is invented here;
the composite only picks, per pixel, the median of the scenes where the SCL mask says the sky was clear.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from app.engine.ndvi import SCL_KEEP

UInt8Array = NDArray[np.uint8]
FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class Composite:
    rgb: UInt8Array
    # Share of output pixels with at least one clear observation (the rest come from the least cloudy scene)
    clear_fraction: float
    scenes_used: int


def true_color_composite(tci: list[NDArray[np.integer]], scl: list[NDArray[np.integer]]) -> Composite:
    """Per-pixel median of clear TCI observations.

    `tci[i]` is (3, h, w) uint8 and `scl[i]` (h, w) for scene i, ordered from least to most cloudy.
    Pixels never clear keep the value of the first scene so the image has no holes; `clear_fraction`
    reports how much of it is really cloud-free.
    """
    if not tci or len(tci) != len(scl):
        raise ValueError("true_color_composite needs one SCL array per TCI scene")
    stack = np.stack([t.astype(np.float64) for t in tci])
    clear = np.stack([np.isin(s, SCL_KEEP) for s in scl])
    # TCI 0 means no data (outside the swath); never treat it as a clear black pixel
    clear &= stack.sum(axis=1) > 0
    masked = np.where(clear[:, None, :, :], stack, np.nan)
    with np.errstate(all="ignore"):
        median = np.nanmedian(masked, axis=0) if clear.any() else np.full(stack.shape[1:], np.nan)
    has_clear = clear.any(axis=0)
    filled = np.where(has_clear[None, :, :], median, stack[0])
    rgb = np.clip(np.rint(np.nan_to_num(filled)), 0, 255).astype(np.uint8).transpose(1, 2, 0)
    return Composite(
        rgb=rgb,
        clear_fraction=round(float(has_clear.mean()), 3),
        scenes_used=int(clear.any(axis=(1, 2)).sum()),
    )


@dataclass(frozen=True)
class HeightStats:
    data: list[float]
    min_m: float
    max_m: float
    nodata_fraction: float


def heightmap_stats(elevation: FloatArray, valid: NDArray[np.bool_]) -> HeightStats:
    """Row-major (north to south) elevations; invalid cells take the valid mean so the 3D mesh has no holes."""
    if not valid.any():
        raise ValueError("no valid elevation in the requested window")
    vals = elevation[valid]
    filled = np.where(valid, elevation, float(vals.mean()))
    return HeightStats(
        data=[round(float(v), 2) for v in filled.ravel()],
        min_m=round(float(vals.min()), 2),
        max_m=round(float(vals.max()), 2),
        nodata_fraction=round(1.0 - float(valid.mean()), 3),
    )
