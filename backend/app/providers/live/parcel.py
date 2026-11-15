"""Shared helpers for live adapters: management-zone rings from the derived parcel and a tiny disk cache."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date
from pathlib import Path

from app.providers.ports import DataNotFoundError

Ring = list[tuple[float, float]]


def zone_rings(derived_dir: Path, farm_id: str) -> dict[str, Ring]:
    """zone_id -> outer ring (lon, lat) from derived/parcel/<farm>.geojson (the farm outline has no zone_id)."""
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
