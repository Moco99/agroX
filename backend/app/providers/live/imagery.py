"""PointImageryProvider: basemap, NDVI images and heightmap for `pt_<lat>_<lon>` farms (live mode).

Sources (global, free, no key, same Planetary Computer API the live NDVI already uses):
- basemap: Sentinel-2 L2A TCI (ESA true colour, 10 m), median of the clearest recent scenes;
- NDVI image of a date: Sentinel-2 L2A B04/B08/SCL of that date, coloured with the canonical ramp;
- heightmap: Copernicus DEM GLO-30 (30 m).
Esri tiles are deliberately not used for server-side textures (terms of use; ADR-025).

Every artifact is written to the live cache (backend/.cache/live/imagery, git-ignored) and the folder is
pruned to `max_mb`, oldest files first.
"""

from __future__ import annotations

import io
import json
import math
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from PIL import Image

from app.engine.imagery import heightmap_stats, true_color_composite
from app.engine.ndvi import S2_BOA_OFFSET, colorize_ndvi, compute_ndvi
from app.providers.live.parcel import ZONE_SIDE_M, _lock_for, point_farm
from app.providers.ports import DataNotFoundError

PC = "https://planetarycomputer.microsoft.com/api"
S2 = "sentinel-2-l2a"
DEM = "cop-dem-glo-30"

# ─────────────────────────────────────────
# Section: Product configuration (documented in ADR-025)
# ─────────────────────────────────────────

# Context around the 600 m farm square so the map shows the neighbourhood; shared by every layer
IMAGERY_MARGIN_M = 150.0
S2_PIXEL_M = 10.0
DEM_PIXEL_M = 30.0
# Composite of the clearest scenes of the last ~4 months: recent enough to look like "now"
BASEMAP_LOOKBACK_DAYS = 120
BASEMAP_MAX_CLOUD_PCT = 20
BASEMAP_MAX_SCENES = 6
REQUEST_TIMEOUT_S = 60.0

Bounds = tuple[float, float, float, float]
Search = Callable[[Bounds, str, str, int | None, int], list[dict[str, object]]]
Crop = Callable[[str, str, Bounds, int, int, tuple[str, ...]], np.ndarray]


# ─────────────────────────────────────────
# Section: API calls
# ─────────────────────────────────────────


def _http(url: str, body: dict[str, object] | None = None) -> bytes:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": "agrox-backend", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        return bytes(resp.read())


def search_items(
    bbox: Bounds, collection: str, period: str, max_cloud: int | None, limit: int
) -> list[dict[str, object]]:
    """STAC items over bbox (least cloudy first when a cloud filter applies)."""
    body: dict[str, object] = {"collections": [collection], "bbox": list(bbox), "limit": limit}
    if period:
        body["datetime"] = period
    if max_cloud is not None:
        body["query"] = {"eo:cloud_cover": {"lt": max_cloud}}
        body["sortby"] = [{"field": "properties.eo:cloud_cover", "direction": "asc"}]
    feats = json.loads(_http(f"{PC}/stac/v1/search", body))["features"]
    return [
        {
            "id": f["id"],
            "date": str(f["properties"].get("datetime") or f["properties"].get("start_datetime") or "")[:10],
            "cloud": f["properties"].get("eo:cloud_cover"),
            "baseline": str(f["properties"].get("s2:processing_baseline", "05.00")),
        }
        for f in feats
    ]


def crop_item(collection: str, item: str, bbox: Bounds, width: int, height: int, assets: tuple[str, ...]) -> np.ndarray:
    """Bands of `assets` cropped to bbox on a width x height grid; the last band is the validity mask."""
    w, s, e, n = bbox
    query = "&".join(f"assets={a}" for a in assets)
    url = f"{PC}/data/v1/item/bbox/{w},{s},{e},{n}.npy?collection={collection}&item={item}&{query}"
    url += f"&width={width}&height={height}"
    arr: np.ndarray = np.load(io.BytesIO(_http(url)))
    return arr


# ─────────────────────────────────────────
# Section: Geometry
# ─────────────────────────────────────────


def imagery_bounds(lat: float, lon: float) -> Bounds:
    """(west, south, east, north) of the farm square plus margin; basemap, NDVI and heightmap share it."""
    half = ZONE_SIDE_M + IMAGERY_MARGIN_M
    dlat = half / 111320
    dlon = half / (111320 * math.cos(math.radians(lat)))
    return (round(lon - dlon, 6), round(lat - dlat, 6), round(lon + dlon, 6), round(lat + dlat, 6))


def grid_shape(bounds: Bounds, pixel_m: float) -> tuple[int, int]:
    """(width, height) in pixels of the native grid of a sensor over bounds."""
    w, s, e, n = bounds
    mid = math.radians((s + n) / 2)
    width = max(8, round((e - w) * 111320 * math.cos(mid) / pixel_m))
    height = max(8, round((n - s) * 111320 / pixel_m))
    return width, height


def prune(folder: Path, max_bytes: int) -> None:
    """Delete the oldest files until the folder fits in max_bytes (keeps the cache bounded)."""
    if not folder.exists():
        return
    files = sorted((p for p in folder.rglob("*") if p.is_file()), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    for p in files:
        if total <= max_bytes:
            break
        total -= p.stat().st_size
        p.unlink(missing_ok=True)


def _png(rgba: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgba).save(out, "PNG")
    return out.getvalue()


def _jpeg(rgb: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "JPEG", quality=90)
    return out.getvalue()


# ─────────────────────────────────────────
# Section: Provider
# ─────────────────────────────────────────


class PointImageryProvider:
    def __init__(
        self,
        cache_dir: Path,
        max_mb: int = 256,
        search: Search = search_items,
        crop: Crop = crop_item,
        today: Callable[[], date] = date.today,
    ) -> None:
        self._dir = cache_dir / "imagery"
        self._max_bytes = max_mb * 1024 * 1024
        self._search, self._crop, self._today = search, crop, today

    def _point(self, farm_id: str) -> tuple[float, float]:
        pt = point_farm(farm_id)
        if pt is None:
            raise DataNotFoundError(f"'{farm_id}' is not a point farm")
        return pt

    def bounds(self, farm_id: str) -> Bounds:
        return imagery_bounds(*self._point(farm_id))

    def _save(self, path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
        prune(self._dir, self._max_bytes)

    # ── Basemap ──

    def _basemap_paths(self, farm_id: str) -> tuple[Path, Path]:
        # One composite per ISO week: recent enough, and a farm opened every day does not refetch it
        year, week, _ = self._today().isocalendar()
        stem = self._dir / farm_id / f"basemap_{year}W{week:02d}"
        return stem.with_suffix(".jpg"), stem.with_suffix(".json")

    def basemap_info(self, farm_id: str) -> dict[str, object] | None:
        """Metadata of this week's composite if it was already built (never triggers the build)."""
        _, meta = self._basemap_paths(farm_id)
        return json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else None

    def basemap(self, farm_id: str) -> tuple[bytes, dict[str, object]]:
        jpg, meta = self._basemap_paths(farm_id)
        with _lock_for(str(jpg)):
            if jpg.exists() and meta.exists():
                return jpg.read_bytes(), json.loads(meta.read_text(encoding="utf-8"))
            bounds = self.bounds(farm_id)
            width, height = grid_shape(bounds, S2_PIXEL_M)
            today = self._today()
            period = f"{today - timedelta(days=BASEMAP_LOOKBACK_DAYS)}T00:00:00Z/{today}T23:59:59Z"
            scenes = self._search(bounds, S2, period, BASEMAP_MAX_CLOUD_PCT, 50)[:BASEMAP_MAX_SCENES]
            if not scenes:
                raise DataNotFoundError(
                    f"no Sentinel-2 scene with cloud < {BASEMAP_MAX_CLOUD_PCT}% "
                    f"in the last {BASEMAP_LOOKBACK_DAYS} days"
                )

            def one(sc: dict[str, object]) -> np.ndarray | None:
                try:
                    return self._crop(S2, str(sc["id"]), bounds, width, height, ("visual", "SCL"))
                except Exception:
                    return None

            with ThreadPoolExecutor(BASEMAP_MAX_SCENES) as ex:
                arrays = list(ex.map(one, scenes))
            used = [(sc, a) for sc, a in zip(scenes, arrays, strict=True) if a is not None]
            if not used:
                raise DataNotFoundError("Sentinel-2 scenes found but none could be read")
            comp = true_color_composite([a[:3] for _, a in used], [a[3] for _, a in used])
            dates = sorted(str(sc["date"]) for sc, _ in used)
            info: dict[str, object] = {
                "width": width,
                "height": height,
                "source": f"Sentinel-2 L2A TCI (ESA true colour) median of {comp.scenes_used} clear scene(s), "
                "Planetary Computer",
                "acquired": dates[-1],
                "acquired_from": dates[0],
                "resolution_m": S2_PIXEL_M,
                "clear_fraction": comp.clear_fraction,
                "scenes": [str(sc["id"]) for sc, _ in used],
            }
            self._save(jpg, _jpeg(comp.rgb))
            self._save(meta, json.dumps(info).encode())
            return jpg.read_bytes(), info

    # ── NDVI image of one date ──

    def ndvi_png(self, farm_id: str, day: date) -> bytes:
        path = self._dir / farm_id / f"ndvi_{day}.png"
        with _lock_for(str(path)):
            if path.exists():
                return path.read_bytes()
            bounds = self.bounds(farm_id)
            width, height = grid_shape(bounds, S2_PIXEL_M)
            scenes = self._search(bounds, S2, f"{day}T00:00:00Z/{day}T23:59:59Z", None, 10)
            if not scenes:
                raise DataNotFoundError(f"no Sentinel-2 scene over this farm on {day}")
            ndvi: np.ndarray | None = None
            # Overlapping tiles of the same pass: fill the gaps of the first with the next
            for sc in scenes[:2]:
                arr = self._crop(S2, str(sc["id"]), bounds, width, height, ("B04", "B08", "SCL"))
                offset = S2_BOA_OFFSET if float(str(sc["baseline"])) >= 4.0 else 0.0
                values, _ = compute_ndvi(arr[0].astype(np.float64), arr[1].astype(np.float64), arr[2], offset)
                ndvi = values if ndvi is None else np.where(np.isfinite(ndvi), ndvi, values)
            assert ndvi is not None
            data = _png(colorize_ndvi(ndvi))
            self._save(path, data)
            return data

    def has_ndvi_png(self, farm_id: str, day: date) -> bool:
        return (self._dir / farm_id / f"ndvi_{day}.png").exists()

    # ── Heightmap ──

    def heightmap(self, farm_id: str) -> dict[str, object]:
        path = self._dir / farm_id / "heightmap.json"
        with _lock_for(str(path)):
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]
            bounds = self.bounds(farm_id)
            width, height = grid_shape(bounds, DEM_PIXEL_M)
            items = self._search(bounds, DEM, "", None, 4)
            if not items:
                raise DataNotFoundError("no Copernicus DEM tile over this farm")
            elev = np.full((height, width), np.nan)
            # A farm on a 1 degree tile edge needs two tiles: each fills the cells its mask marks valid
            for it in items:
                arr = self._crop(DEM, str(it["id"]), bounds, width, height, ("data",))
                valid = arr[-1] > 0
                elev = np.where(np.isnan(elev) & valid, arr[0].astype(np.float64), elev)
            stats = heightmap_stats(elev, np.isfinite(elev))
            mid = math.radians((bounds[1] + bounds[3]) / 2)
            doc: dict[str, object] = {
                "bounds_wgs84": list(bounds),
                "width": width,
                "height": height,
                "min_m": stats.min_m,
                "max_m": stats.max_m,
                "resolution_m": round((bounds[2] - bounds[0]) * 111320 * math.cos(mid) / width, 1),
                "row_order": "north_to_south",
                "data": stats.data,
                "nodata_fraction": stats.nodata_fraction,
                "tiles": [str(it["id"]) for it in items],
            }
            self._save(path, json.dumps(doc).encode())
            return doc
