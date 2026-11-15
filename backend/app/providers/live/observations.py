"""LiveObservationProvider: Sentinel-2 NDVI per zone computed from the Planetary Computer API.

For every scene over the farm (2021 -> today) the API returns B04, B08 and SCL cropped to the farm bbox
as a numpy array; the zone mean is taken over clear pixels (SCL 4/5/6), with the +1000 BOA offset removed
only for processing baseline >= 04.00 (same rules as pipeline/build_ndvi.py). MODIS, SMAP and the overlay
stay on derived/. Cached per farm and day; on failure the derived series is served with a warning.
"""

from __future__ import annotations

import io
import json
import math
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np

from app.providers.live.parcel import Ring, cached, inside, peek_cached, zone_rings
from app.providers.real.observations import RealObservationProvider
from app.schemas.common import DataState, Provenance
from app.schemas.observations import ObservationPoint, ObservationSeries, ObservationVariable

PC = "https://planetarycomputer.microsoft.com/api"
HISTORY_START = "2021-01-01"
MAX_CLOUD_PCT = 30
# Bound the upstream fan-out while retaining observations across the available history.
MAX_SCENES = 72
S2_BOA_OFFSET = -1000.0
SCL_KEEP = (4, 5, 6)

Scene = dict[str, str]
Search = Callable[[list[float], str], list[Scene]]
Crop = Callable[[str, list[float], int, int], np.ndarray]


# ─────────────────────────────────────────
# Section: API calls
# ─────────────────────────────────────────


def _http(url: str, body: dict[str, object] | None = None) -> bytes:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": "agrox-backend", "Content-Type": "application/json"}
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=20) as resp:
        return bytes(resp.read())


def search_scenes(bbox: list[float], end: str) -> list[Scene]:
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": bbox,
        "datetime": f"{HISTORY_START}T00:00:00Z/{end}T23:59:59Z",
        "limit": 1000,
        "query": {"eo:cloud_cover": {"lt": MAX_CLOUD_PCT}},
    }
    feats = json.loads(_http(f"{PC}/stac/v1/search", body))["features"]
    return [
        {
            "id": f["id"],
            "date": f["properties"]["datetime"][:10],
            "baseline": str(f["properties"].get("s2:processing_baseline", "05.00")),
        }
        for f in feats
    ]


def crop_scene(item_id: str, bbox: list[float], width: int, height: int) -> np.ndarray:
    w, s, e, n = bbox
    url = (
        f"{PC}/data/v1/item/bbox/{w},{s},{e},{n}.npy?collection=sentinel-2-l2a&item={item_id}"
        f"&assets=B04&assets=B08&assets=SCL&width={width}&height={height}"
    )
    arr: np.ndarray = np.load(io.BytesIO(_http(url)))
    return arr


# ─────────────────────────────────────────
# Section: NDVI per zone (pure)
# ─────────────────────────────────────────


def zone_masks(shape: tuple[int, int], bbox: list[float], rings: dict[str, Ring]) -> dict[str, np.ndarray]:
    """Boolean mask per zone on the output pixel grid; the grid is the same for every scene, so build it once."""
    h, w = shape
    west, south, east, north = bbox
    lons = west + (np.arange(w) + 0.5) * (east - west) / w
    lats = north - (np.arange(h) + 0.5) * (north - south) / h
    return {zid: np.array([[inside(lon, lat, ring) for lon in lons] for lat in lats]) for zid, ring in rings.items()}


def zone_ndvi(arr: np.ndarray, masks: dict[str, np.ndarray], baseline: str) -> dict[str, tuple[float, int]]:
    """zone_id -> (mean NDVI, clear pixels) for one scene; zones without clear pixels are omitted."""
    red, nir, scl = arr[0].astype(float), arr[1].astype(float), arr[2]
    offset = S2_BOA_OFFSET if float(baseline) >= 4.0 else 0.0
    valid = np.isin(scl, SCL_KEEP) & (red > 0) & (nir > 0)
    r, n_ = (red + offset) / 10000.0, (nir + offset) / 10000.0
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = np.where(r + n_ != 0, (n_ - r) / (r + n_), np.nan)
    out: dict[str, tuple[float, int]] = {}
    for zid, mask in masks.items():
        vals = ndvi[mask & valid]
        vals = vals[np.isfinite(vals)]
        if vals.size:
            out[zid] = (round(float(np.clip(vals, -1, 1).mean()), 4), int(vals.size))
    return out


# ─────────────────────────────────────────
# Section: Provider
# ─────────────────────────────────────────


class LiveObservationProvider(RealObservationProvider):
    def __init__(
        self,
        derived_dir: Path,
        cache_dir: Path,
        search: Search = search_scenes,
        crop: Crop = crop_scene,
        today: Callable[[], date] = date.today,
    ) -> None:
        super().__init__(derived_dir)
        self._cache_dir = cache_dir
        self._search, self._crop, self._today = search, crop, today

    def _grid(self, farm_id: str) -> tuple[dict[str, Ring], list[float], int, int]:
        rings = zone_rings(self._dir, farm_id)
        xs = [p[0] for ring in rings.values() for p in ring]
        ys = [p[1] for ring in rings.values() for p in ring]
        bbox = [min(xs), min(ys), max(xs), max(ys)]
        # ~10 m pixels so the zone means use the native Sentinel-2 resolution
        width = max(8, round((bbox[2] - bbox[0]) * 111320 * math.cos(math.radians(bbox[1])) / 10))
        height = max(8, round((bbox[3] - bbox[1]) * 111320 / 10))
        return rings, bbox, width, height

    def cached_rows(self, farm_id: str) -> list[dict[str, object]] | None:
        """Today's live rows if already built; never starts the (slow) build."""
        return peek_cached(self._cache_dir, f"s2_ndvi_{farm_id}", self._today())

    def series_ready(self, farm_id: str) -> bool:
        return self.cached_rows(farm_id) is not None

    def farm_pixel_total(self, farm_id: str) -> int:
        """Pixels inside the zones on the analysis grid: denominator of the per-date valid fraction."""
        rings, bbox, width, height = self._grid(farm_id)
        return int(sum(int(m.sum()) for m in zone_masks((height, width), bbox, rings).values()))

    def _live_points(self, farm_id: str) -> list[dict[str, object]]:
        rings, bbox, width, height = self._grid(farm_id)
        today = self._today()

        def build() -> list[dict[str, object]]:
            scenes = self._search(bbox, today.isoformat())
            masks = zone_masks((height, width), bbox, rings)
            scenes = sorted(scenes, key=lambda scene: (scene["date"], scene["id"]))
            if len(scenes) > MAX_SCENES:
                scenes = [scenes[round(i * (len(scenes) - 1) / (MAX_SCENES - 1))] for i in range(MAX_SCENES)]

            def one(sc: Scene) -> list[dict[str, object]] | None:
                try:
                    arr = self._crop(sc["id"], bbox, width, height)
                except Exception:
                    return None
                return [
                    {"date": sc["date"], "zone_id": z, "ndvi": v, "n_pixels": n}
                    for z, (v, n) in zone_ndvi(arr, masks, sc["baseline"]).items()
                ]

            with ThreadPoolExecutor(16) as ex:
                results = list(ex.map(one, scenes))
            if results and all(result is None for result in results):
                raise RuntimeError("Sentinel-2 scene reads failed")
            rows = [row for result in results if result is not None for row in result]
            # Overlapping tiles give the same date twice: keep one mean per date and zone
            merged: dict[tuple[str, str], list[dict[str, object]]] = {}
            for row in rows:
                merged.setdefault((str(row["date"]), str(row["zone_id"])), []).append(row)
            return [
                {
                    "date": d,
                    "zone_id": z,
                    "ndvi": round(sum(float(str(r["ndvi"])) for r in rs) / len(rs), 4),
                    "n_pixels": sum(int(r["n_pixels"]) for r in rs),  # type: ignore[call-overload]
                }
                for (d, z), rs in sorted(merged.items())
            ]

        return cached(self._cache_dir, f"s2_ndvi_{farm_id}", build, today)

    def ndvi_series(self, farm_id: str, source_id: str) -> ObservationSeries:
        if source_id != "sentinel2":
            return super().ndvi_series(farm_id, source_id)
        try:
            rows = self._live_points(farm_id)
        except Exception as exc:
            series = super().ndvi_series(farm_id, source_id)
            reason = f"{type(exc).__name__}: {str(exc)[:160]}"
            return series.model_copy(update={"warnings": [*series.warnings, f"Sentinel-2 API failed ({reason})"]})
        points = [
            ObservationPoint(
                date=date.fromisoformat(str(r["date"])),
                variable=ObservationVariable.NDVI,
                value=float(r["ndvi"]),  # type: ignore[arg-type]
                zone_id=str(r["zone_id"]),
                n_pixels=int(r["n_pixels"]),  # type: ignore[call-overload]
            )
            for r in rows
        ]
        return ObservationSeries(
            variable=ObservationVariable.NDVI,
            source_id=source_id,
            resolution_m=10.0,
            points=points,
            provenance=Provenance(
                source="Sentinel-2 L2A via Planetary Computer API (live)",
                data_state=DataState.MEASURED,
                resolution="10 m (SCL 20 m)",
                method=f"scenes {HISTORY_START}->today with cloud < {MAX_CLOUD_PCT}%; zone mean over SCL "
                f"{list(SCL_KEEP)}; BOA offset {S2_BOA_OFFSET:+.0f} only for baseline >= 04.00",
            ),
            warnings=[
                f"{len({p.date for p in points})} clear dates since {HISTORY_START}; up to {MAX_SCENES} "
                "scenes sampled, cloud gaps and failed scene reads may leave gaps"
            ],
        )
