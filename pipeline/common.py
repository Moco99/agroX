"""Shared constants and helpers for the raw -> derived pipeline.

Paths are resolved relative to the repository root so the scripts work from any
cwd. Nothing here touches the network.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.engine.ndvi import colorize_ndvi

# ─────────────────────────────────────────
# Section: Paths
# ─────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = REPO_ROOT / "data" / "raw"
DERIVED_DIR = REPO_ROOT / "backend" / "app" / "data" / "derived"
MANIFEST_PATH = DERIVED_DIR / "manifest.json"

# ─────────────────────────────────────────
# Section: Pilot area (mirrors scraper/sources.json)
# ─────────────────────────────────────────

# Scraper bbox (lon_min, lat_min, lon_max, lat_max), Story County, Ames, Iowa
PILOT_BBOX = (-93.55, 41.95, -93.43, 42.04)
# NASA POWER point used by the scraper (centre of the bbox)
POWER_LAT = 41.995
POWER_LON = -93.49
# Elevation declared in the POWER header (MERRA-2 cell average); SRTM refines per zone
POWER_ELEVATION_M = 310.22

SITE_ID = "story_pilot"
FARM_ID = "story_pilot_farm"

# USDA CDL class codes used for the pilot (only the ones we interpret)
CDL_CODES: dict[int, str] = {
    1: "corn",
    5: "soybean",
    24: "winter_wheat",
    28: "oat",
    36: "alfalfa",
    37: "other_hay",
    61: "fallow",
    111: "open_water",
    121: "developed_open",
    122: "developed_low",
    123: "developed_medium",
    124: "developed_high",
    141: "deciduous_forest",
    176: "grass_pasture",
    190: "woody_wetland",
    195: "herbaceous_wetland",
}

# ─────────────────────────────────────────
# Section: NDVI colour ramp (single implementation in app.engine.ndvi, mirror of docs/07-design/design-tokens.md)
# ─────────────────────────────────────────


def ndvi_to_rgb(value: float) -> tuple[int, int, int]:
    """Map one NDVI value to the canonical ramp colour (same stops as the frontend)."""
    rgba = colorize_ndvi(np.array([[value]], dtype=np.float64))
    return int(rgba[0, 0, 0]), int(rgba[0, 0, 1]), int(rgba[0, 0, 2])


# ─────────────────────────────────────────
# Section: Common analysis area (farm + margin) shared by basemap, NDVI overlays and heightmap
# ─────────────────────────────────────────

# Margin around the farm bbox so the 3D scene and the map show some surrounding context
AREA_MARGIN_DEG = 0.004


def farm_area_bounds() -> tuple[float, float, float, float]:
    """(west, south, east, north) of the farm bbox plus AREA_MARGIN_DEG, read from the derived parcel."""
    parcel = json.loads((DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson").read_text())
    farm = next(f for f in parcel["features"] if f["properties"]["feature_kind"] == "farm")
    ring = farm["geometry"]["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    m = AREA_MARGIN_DEG
    return round(min(lons) - m, 6), round(min(lats) - m, 6), round(max(lons) + m, 6), round(max(lats) + m, 6)


# ─────────────────────────────────────────
# Section: Manifest helpers
# ─────────────────────────────────────────


def sha256_of(path: Path, limit_bytes: int = 200_000_000) -> str | None:
    """Hash an input file; very large inputs are skipped (None) to keep builds fast."""
    if not path.exists() or path.stat().st_size > limit_bytes:
        return None
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {"version": 1, "artifacts": {}}


def register_artifact(artifact_id: str, entry: dict[str, Any]) -> None:
    """Upsert one artifact entry; the manifest is the index the backend trusts."""
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    entry = {**entry, "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
    manifest["artifacts"][artifact_id] = entry
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")


def relative_to_derived(path: Path) -> str:
    # as_posix: on Windows str() gives backslashes, which would break the versioned manifest on Linux
    return path.relative_to(DERIVED_DIR).as_posix()
