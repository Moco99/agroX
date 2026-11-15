"""Run every build step in dependency order (parcel first: soil/terrain/ndvi/smap need the zones).

Usage: backend/.venv/bin/python -m pipeline.build_all   (from the repository root)
"""

from __future__ import annotations

import sys
import time

from pipeline import build_catalog, build_ndvi, build_parcel, build_smap, build_soil, build_terrain, build_weather
from pipeline.common import DERIVED_DIR, RAW_DIR

STEPS = [
    ("catalog", build_catalog.build),
    ("weather", build_weather.build),
    ("parcel", build_parcel.build),
    ("terrain", build_terrain.build),
    ("soil", build_soil.build),
    ("ndvi", build_ndvi.build),
    ("smap", build_smap.build),
]


def main() -> int:
    if not RAW_DIR.exists():
        print(f"raw data folder not found: {RAW_DIR} (run the scraper first)")
        return 1
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0
    for name, fn in STEPS:
        t0 = time.time()
        try:
            fn()
            print(f"[{name}] ok in {time.time() - t0:.1f}s")
        except Exception as exc:  # noqa: BLE001 - one failing source must not block the others
            failures += 1
            print(f"[{name}] FAILED: {exc!r}")
    print(f"derived -> {DERIVED_DIR} ({failures} failures)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
