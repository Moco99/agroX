"""Windowed raster reads over an ObjectStore: Sentinel-2 scenes, NAIP tiles, elevation.

Every read targets one explicit output grid (bounds + shape) so layers from different
sensors line up exactly, whatever their native resolution.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

try:
    from rasterio.enums import Resampling
    from rasterio.transform import Affine, from_bounds
    from rasterio.vrt import WarpedVRT
except ImportError:
    Resampling = None
    Affine = None
    from_bounds = None
    WarpedVRT = None

from app.engine.ndvi import BoolArray, FloatArray, compute_ndvi, s2_offset
from app.storage.ports import ObjectNotFoundError, ObjectStore

Bounds = tuple[float, float, float, float]

S2_PREFIX = "sentinel2/"
_S2_RE = re.compile(r"^sentinel2/(S2[AB]_MSIL2A_(\d{8})T\d{6}_R\d{3}_T\w{5}_(\d{8})T\d{6})_(B04|B08|SCL)\.tif$")


@dataclass(frozen=True)
class S2Scene:
    scene_id: str
    date: str
    processed: str
    keys: dict[str, str]


@dataclass(frozen=True)
class Grid:
    """Target grid: WGS84 bounds (west, south, east, north) and pixel shape."""

    bounds: Bounds
    width: int
    height: int

    @property
    def transform(self) -> Affine:
        west, south, east, north = self.bounds
        return from_bounds(west, south, east, north, self.width, self.height)


def list_s2_scenes(store: ObjectStore) -> list[S2Scene]:
    """Complete B04+B08+SCL triplets, sorted by date then processing time."""
    groups: dict[str, dict[str, str]] = {}
    meta: dict[str, tuple[str, str]] = {}
    for obj in store.list_objects(S2_PREFIX):
        m = _S2_RE.match(obj.key)
        if not m:
            continue
        scene_id, day, processed, band = m.groups()
        groups.setdefault(scene_id, {})[band] = obj.key
        meta[scene_id] = (f"{day[:4]}-{day[4:6]}-{day[6:]}", processed)
    scenes = [
        S2Scene(scene_id=sid, date=meta[sid][0], processed=meta[sid][1], keys=keys)
        for sid, keys in groups.items()
        if {"B04", "B08", "SCL"} <= set(keys)
    ]
    return sorted(scenes, key=lambda s: (s.date, s.processed))


def read_window(
    store: ObjectStore, key: str, grid: Grid, bands: tuple[int, ...] | None = None, nearest: bool = True
) -> np.ndarray:
    """Read the grid's footprint from one raster, resampled onto the grid shape."""
    resampling = Resampling.nearest if nearest else Resampling.bilinear
    with store.open_raster(key) as src:
        indexes = list(bands) if bands else None
        # VRT projects every source onto the identical WGS84 output grid and
        # preserves GDAL windowed I/O for remote rasters in projected CRSs.
        with WarpedVRT(
            src, crs="EPSG:4326", transform=grid.transform, width=grid.width, height=grid.height, resampling=resampling
        ) as vrt:
            data = vrt.read(indexes)

    return np.asarray(data)


def s2_grid(store: ObjectStore, scene: S2Scene, bounds: Bounds) -> Grid:
    """Output grid at the scene's native 10 m pixel size covering `bounds`."""
    with store.open_raster(scene.keys["B04"]) as src:
        res_x, res_y = abs(src.res[0]), abs(src.res[1])
    west, south, east, north = bounds
    return Grid(bounds, max(int(round((east - west) / res_x)), 1), max(int(round((north - south) / res_y)), 1))


def read_scene_ndvi(store: ObjectStore, scene: S2Scene, grid: Grid) -> tuple[FloatArray, BoolArray]:
    """NDVI and validity for one scene on `grid` (SCL, 20 m, is resampled by nearest neighbour)."""
    try:
        red = read_window(store, scene.keys["B04"], grid, (1,))[0].astype(np.float64)
        nir = read_window(store, scene.keys["B08"], grid, (1,))[0].astype(np.float64)
        scl = read_window(store, scene.keys["SCL"], grid, (1,))[0]
    except KeyError as exc:
        raise ObjectNotFoundError(scene.scene_id) from exc
    return compute_ndvi(red, nir, scl, offset=s2_offset(scene.scene_id))
