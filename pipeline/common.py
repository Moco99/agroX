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
# Section: NDVI colour ramp (mirror of docs/07-design/design-tokens.md)
# ─────────────────────────────────────────

# (ndvi_stop, (r, g, b)); linear interpolation in RGB, clipped outside the domain
NDVI_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (0.20, (0xDC, 0x34, 0x2E)),
    (0.35, (0xF1, 0x97, 0x28)),
    (0.50, (0xF0, 0xE5, 0x33)),
    (0.65, (0x6F, 0xBE, 0x30)),
    (0.80, (0x31, 0x9D, 0x34)),
]
NDVI_NODATA_RGB = (0x4B, 0x55, 0x63)


def ndvi_to_rgb(value: float) -> tuple[int, int, int]:
    """Map an NDVI value to the canonical ramp colour (same stops as the frontend)."""
    if value != value or value < 0:
        return NDVI_NODATA_RGB
    if value <= NDVI_RAMP[0][0]:
        return NDVI_RAMP[0][1]
    if value >= NDVI_RAMP[-1][0]:
        return NDVI_RAMP[-1][1]
    for (v0, c0), (v1, c1) in zip(NDVI_RAMP, NDVI_RAMP[1:], strict=False):
        if v0 <= value <= v1:
            t = (value - v0) / (v1 - v0)
            return tuple(int(round(c0[i] + t * (c1[i] - c0[i]))) for i in range(3))  # type: ignore[return-value]
    return NDVI_NODATA_RGB


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
    return str(path.relative_to(DERIVED_DIR))
