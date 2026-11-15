"""Shared helpers for live adapters: management-zone rings from the derived parcel and a tiny disk cache."""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from collections.abc import Callable
from datetime import date
from pathlib import Path

from app.config import DEFAULT_LIVE_CACHE_DIR
from app.providers.ports import DataNotFoundError, InvalidFarmIdError

Ring = list[tuple[float, float]]


# A farm id "pt_<lat>_<lon>" is a 2x2-zone square centred on that point: it lets every endpoint work anywhere
POINT_FARM = re.compile(r"^pt_(-?\d{1,2}(?:\.\d+)?)_(-?\d{1,3}(?:\.\d+)?)$")
POINT_PREFIX = "pt_"
# POWER and SoilGrids do not cover the poles; Sentinel-2 stops near 84 N; Antarctica has no cropland
MIN_LAT, MAX_LAT = -60.0, 75.0
ZONE_SIDE_M = 300.0
ZONE_NAMES = {
    "zone_nw": "Zona noroeste",
    "zone_ne": "Zona noreste",
    "zone_sw": "Zona suroeste",
    "zone_se": "Zona sureste",
}


# ─────────────────────────────────────────
# Section: Drawn (polygon) farms
# ─────────────────────────────────────────

# A farm id "poly_<lat>_<lon>_<hash>" is a set of user-drawn polygons registered by POST /api/farms/polygon:
# the centre lets clients place the farm without a request, the content hash maps the same drawing to the same
# id and caches
POLY_FARM = re.compile(r"^poly_-?\d{1,2}\.\d{4}_-?\d{1,3}\.\d{4}_[0-9a-f]{12}$")
POLY_PREFIX = "poly_"
# Module-level so tests can point it at tmp_path; registered geometries survive restarts on disk
POLYGON_DIR = DEFAULT_LIVE_CACHE_DIR / "parcels"
MAX_POLYGONS = 12
MIN_VERTICES, MAX_VERTICES = 3, 100
MIN_ZONE_HA, MAX_FARM_HA = 0.05, 2000.0
# Imagery is cropped to the bbox of all polygons: keep it at most ~6 km so one request stays small
MAX_SPAN_M = 6000.0
M_PER_DEG = 111320.0
Pt = tuple[float, float]


def _segments_cross(a: Pt, b: Pt, c: Pt, d: Pt) -> bool:
    def orient(p: Pt, q: Pt, r: Pt) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1, d2, d3, d4 = orient(c, d, a), orient(c, d, b), orient(a, b, c), orient(a, b, d)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0) and 0 not in (d1, d2, d3, d4)


def is_simple(ring: Ring) -> bool:
    """True when no two non-adjacent edges of the closed ring cross (O(n^2), n <= MAX_VERTICES)."""
    n = len(ring) - 1
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if _segments_cross(ring[i], ring[i + 1], ring[j], ring[j + 1]):
                return False
    return True


def ring_area_ha(ring: Ring) -> float:
    """Approximate geodesic area: shoelace on a local equirectangular projection (error << 1 % at farm scale)."""
    lat0 = math.radians(sum(p[1] for p in ring[:-1]) / (len(ring) - 1))
    xy = [(x * M_PER_DEG * math.cos(lat0), y * M_PER_DEG) for x, y in ring]
    twice = sum(xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1] for i in range(len(xy) - 1))
    return abs(twice) / 2 / 10000


def rings_bbox(rings: list[Ring]) -> tuple[float, float, float, float]:
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def validate_polygons(polygons: list[list[Pt]]) -> list[Ring]:
    """(lat, lon) vertex lists -> closed (lon, lat) rings; InvalidFarmIdError (HTTP 422) on bad input."""
    if not 1 <= len(polygons) <= MAX_POLYGONS:
        raise InvalidFarmIdError(f"expected 1..{MAX_POLYGONS} polygons, got {len(polygons)}")
    rings: list[Ring] = []
    for k, poly in enumerate(polygons, 1):
        pts = list(poly[:-1] if len(poly) > 1 and poly[0] == poly[-1] else poly)
        if not MIN_VERTICES <= len(pts) <= MAX_VERTICES:
            raise InvalidFarmIdError(f"polygon {k}: expected {MIN_VERTICES}..{MAX_VERTICES} vertices, got {len(pts)}")
        for lat, lon in pts:
            if not (math.isfinite(lat) and math.isfinite(lon)):
                raise InvalidFarmIdError(f"polygon {k}: non-finite coordinate")
            if not MIN_LAT <= lat <= MAX_LAT:
                raise InvalidFarmIdError(f"polygon {k}: latitude {lat} outside {MIN_LAT:g}..{MAX_LAT:g}")
            if not -180.0 <= lon <= 180.0:
                raise InvalidFarmIdError(f"polygon {k}: longitude {lon} outside -180..180")
        ring: Ring = [(round(lon, 6), round(lat, 6)) for lat, lon in pts]
        ring.append(ring[0])
        if not is_simple(ring):
            raise InvalidFarmIdError(f"polygon {k} crosses itself")
        if ring_area_ha(ring) < MIN_ZONE_HA:
            raise InvalidFarmIdError(f"polygon {k} is smaller than {MIN_ZONE_HA} ha")
        rings.append(ring)
    total = sum(ring_area_ha(r) for r in rings)
    if total > MAX_FARM_HA:
        raise InvalidFarmIdError(f"total area {total:.0f} ha exceeds {MAX_FARM_HA:g} ha")
    w, s, e, n = rings_bbox(rings)
    span = max((e - w) * M_PER_DEG * math.cos(math.radians((s + n) / 2)), (n - s) * M_PER_DEG)
    if span > MAX_SPAN_M:
        raise InvalidFarmIdError(f"polygons span {span / 1000:.1f} km; keep them within {MAX_SPAN_M / 1000:g} km")
    return rings


def register_polygon_farm(polygons: list[list[Pt]]) -> str:
    """Validate, store and return the content-addressed id of a drawn farm (idempotent)."""
    rings = validate_polygons(polygons)
    doc = json.dumps([[list(p) for p in r] for r in rings])
    w, s, e, n = rings_bbox(rings)
    farm_id = f"{POLY_PREFIX}{(s + n) / 2:.4f}_{(w + e) / 2:.4f}_{hashlib.sha256(doc.encode()).hexdigest()[:12]}"
    path = POLYGON_DIR / f"{farm_id}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_text(doc, encoding="utf-8")
        tmp.replace(path)
    return farm_id


def polygon_zone_rings(farm_id: str) -> dict[str, Ring]:
    """zone_<n> -> ring of a registered drawn farm; 422 for a malformed id, 404 if never registered."""
    if not POLY_FARM.match(farm_id):
        raise InvalidFarmIdError(f"invalid polygon farm id '{farm_id[:40]}': expected poly_<lat>_<lon>_<12 hex>")
    path = POLYGON_DIR / f"{farm_id}.json"
    if not path.exists():
        raise DataNotFoundError(f"polygon farm '{farm_id}' is not registered (POST /api/farms/polygon)")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {f"zone_{i}": [(float(x), float(y)) for x, y in r] for i, r in enumerate(raw, 1)}


def is_polygon_farm(farm_id: str) -> bool:
    return farm_id.startswith(POLY_PREFIX)


def custom_rings(farm_id: str) -> dict[str, Ring] | None:
    """Generated zones of a point or drawn farm; None for pilot farms (their rings come from derived/)."""
    if is_polygon_farm(farm_id):
        return polygon_zone_rings(farm_id)
    pt = point_farm(farm_id)
    return None if pt is None else point_zone_rings(*pt)


def point_farm(farm_id: str) -> tuple[float, float] | None:
    """(lat, lon) for a point farm or a drawn farm (its bbox centre); None for any other id (pilot farms).

    An id that starts with `pt_` but is malformed or out of range raises InvalidFarmIdError (HTTP 422)
    instead of a generic "farm not found", so the UI can tell the user what is wrong with the point.
    """
    if is_polygon_farm(farm_id):
        w, s, e, n = rings_bbox(list(polygon_zone_rings(farm_id).values()))
        return (s + n) / 2, (w + e) / 2
    if not farm_id.startswith(POINT_PREFIX):
        return None
    m = POINT_FARM.match(farm_id)
    if not m:
        raise InvalidFarmIdError(
            f"invalid point farm id '{farm_id[:40]}': expected pt_<lat>_<lon>, e.g. pt_18.83_-96.78"
        )
    lat, lon = float(m.group(1)), float(m.group(2))
    if not MIN_LAT <= lat <= MAX_LAT:
        raise InvalidFarmIdError(f"latitude {lat} outside the supported range {MIN_LAT:g}..{MAX_LAT:g}")
    if not -180.0 <= lon <= 180.0:
        raise InvalidFarmIdError(f"longitude {lon} outside -180..180")
    return lat, lon


def is_point_farm(farm_id: str) -> bool:
    return farm_id.startswith((POINT_PREFIX, POLY_PREFIX))


def point_zone_rings(lat: float, lon: float) -> dict[str, Ring]:
    dlat = ZONE_SIDE_M / 111320
    dlon = ZONE_SIDE_M / (111320 * math.cos(math.radians(lat)))
    out: dict[str, Ring] = {}
    for zid, (row, col) in {"zone_nw": (0, -1), "zone_ne": (0, 0), "zone_sw": (-1, -1), "zone_se": (-1, 0)}.items():
        w, s = lon + col * dlon, lat + row * dlat
        out[zid] = [(w, s), (w + dlon, s), (w + dlon, s + dlat), (w, s + dlat), (w, s)]
    return out


def zone_rings(derived_dir: Path, farm_id: str) -> dict[str, Ring]:
    """zone_id -> outer ring (lon, lat): point farms are generated, pilot farms come from derived/parcel."""
    custom = custom_rings(farm_id)
    if custom is not None:
        return custom
    path = derived_dir / "parcel" / f"{farm_id}.geojson"
    if not path.exists():
        raise DataNotFoundError(f"no parcel for farm '{farm_id}'")
    doc = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, Ring] = {}
    for feat in doc.get("features", []):
        zid = feat.get("properties", {}).get("zone_id")
        if zid:
            out[str(zid)] = [(float(x), float(y)) for x, y in feat["geometry"]["coordinates"][0]]
    if not out:
        raise DataNotFoundError(f"parcel for '{farm_id}' has no zones")
    return out


def centroid(ring: Ring) -> tuple[float, float]:
    # Vertex mean is enough for the small rectangular zones the pipeline produces
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def inside(lon: float, lat: float, ring: Ring) -> bool:
    """Ray casting point-in-polygon."""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


# One lock per cache entry: concurrent requests for the same slow build (e.g. the NDVI series of a new
# farm, ~60 s) wait for the first one instead of hammering the source API N times
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.Lock())


def cache_path(cache_dir: Path, name: str, today: date) -> Path:
    return cache_dir / f"{name}_{today}.json"


def peek_cached[T](cache_dir: Path, name: str, today: date) -> T | None:
    """The cached value if today's entry exists, without building it (used to avoid blocking a response)."""
    path = cache_path(cache_dir, name, today)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def cached[T](cache_dir: Path, name: str, build: Callable[[], T], today: date) -> T:
    """JSON disk cache valid for one day (live sources change daily at most); single-flight per entry."""
    path = cache_path(cache_dir, name, today)
    with _lock_for(str(path)):
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]
        value = build()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write then rename so a crash mid-write never leaves a truncated JSON that poisons the day
        tmp = path.with_suffix(".part")
        tmp.write_text(json.dumps(value), encoding="utf-8")
        tmp.replace(path)
        return value
