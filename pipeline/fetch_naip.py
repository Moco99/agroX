"""Fallback NAIP source for the basemap: Microsoft Planetary Computer COG, windowed to the farm area.

The scraped NAIP quads in the raw mirror do not cover the pilot farm (they are the quarter-quads
`4209360_se` and `4109304_ne`; the farm lies in `4209361_sw`). When coverage of the common area is
incomplete, this step reads just the farm window from the public COG (a few MB through overviews).
Needs network; the result is versioned in derived/ so a rebuild without network keeps the last one.
Read-only: nothing is written to S3 or data/raw.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds

from app.providers.imagery.rasters import Grid

STAC_ITEM = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/naip/items/{item}"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"
# 2023-08-30, 0.3 m, same flight season as the quads in the raw mirror (2023-09-02)
NAIP_ITEM = "ia_m_4209361_sw_15_030_20230830_20240104"
TIMEOUT_S = 30


def _get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=TIMEOUT_S) as resp:  # noqa: S310 - fixed https endpoints
        data = json.loads(resp.read())
    if not isinstance(data, dict):
        raise ValueError("unexpected STAC response")
    return data


def read_naip_window(grid: Grid) -> tuple[np.ndarray, dict[str, str]]:
    """Return (4, H, W) uint8 R,G,B,NIR on `grid` plus provenance facts (no token in them)."""
    item = _get_json(STAC_ITEM.format(item=NAIP_ITEM))
    href = str(item["assets"]["image"]["href"])
    token = str(_get_json(SAS_TOKEN)["token"])
    signed = f"{href}?{token}"
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(signed) as src:
            # Window in the source CRS (UTM) with a small pad for the reprojection kernel; reading at the target
            # size makes GDAL pick an overview level, so only a few MB cross the network instead of the 0.3 m pixels
            west, south, east, north = transform_bounds("EPSG:4326", src.crs, *grid.bounds)
            pad = 20.0
            window = from_bounds(west - pad, south - pad, east + pad, north + pad, transform=src.transform)
            src_w = max(int(round(grid.width * 1.05)), 1)
            src_h = max(int(round(grid.height * 1.05)), 1)
            block = src.read([1, 2, 3, 4], window=window, out_shape=(4, src_h, src_w), resampling=Resampling.average)
            src_transform = src.window_transform(window) * Affine.scale(window.width / src_w, window.height / src_h)
            out = np.zeros((4, grid.height, grid.width), dtype=np.uint8)
            for band in range(4):
                reproject(
                    block[band],
                    out[band],
                    src_transform=src_transform,
                    src_crs=src.crs,
                    dst_transform=grid.transform,
                    dst_crs="EPSG:4326",
                    resampling=Resampling.bilinear,
                )
    data = out
    props = item["properties"]
    facts = {
        "item": NAIP_ITEM,
        "acquired": str(props.get("datetime", ""))[:10],
        "gsd_m": str(props.get("gsd", "")),
        "producer": "USDA Farm Service Agency (NAIP, public domain)",
        "host": urllib.parse.urlparse(href).netloc,
    }
    return np.asarray(data), facts
