"""Shared helpers for live adapters: management-zone rings from the derived parcel and a tiny disk cache."""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable
from datetime import date
from pathlib import Path

from app.providers.ports import DataNotFoundError

Ring = list[tuple[float, float]]


# A farm id "pt_<lat>_<lon>" is a 2x2-zone square centred on that point: it lets every endpoint work anywhere
POINT_FARM = re.compile(r"^pt_(-?\d{1,2}(?:\.\d+)?)_(-?\d{1,3}(?:\.\d+)?)$")
ZONE_SIDE_M = 300.0
ZONE_NAMES = {
    "zone_nw": "Zona noroeste",
    "zone_ne": "Zona noreste",
    "zone_sw": "Zona suroeste",
    "zone_se": "Zona sureste",
}


def point_farm(farm_id: str) -> tuple[float, float] | None:
    """(lat, lon) for a valid point-farm id, else None."""
    m = POINT_FARM.match(farm_id)
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    # POWER and SoilGrids do not cover the poles; Sentinel-2 stops near 84 N
    return (lat, lon) if -60 <= lat <= 75 and -180 <= lon <= 180 else None


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
    pt = point_farm(farm_id)
    if pt is not None:
        return point_zone_rings(*pt)
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


def cached[T](cache_dir: Path, name: str, build: Callable[[], T], today: date) -> T:
    """JSON disk cache valid for one day (live sources change daily at most)."""
    path = cache_dir / f"{name}_{today}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]
    value = build()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return value
