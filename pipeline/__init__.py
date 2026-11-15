"""raw -> derived pipeline for the AGROX pilot farm.

Each build_* module is idempotent, needs no network and writes small artifacts
(JSON/CSV/PNG) into backend/app/data/derived/ plus an entry in manifest.json.
"""

import sys
from pathlib import Path

# The pipeline reuses backend modules (pure NDVI maths, raster windows, object stores) so a number never depends
# on which path produced it; the backend folder is added here so `python -m pipeline.x` works from the repo root
_BACKEND = str(Path(__file__).resolve().parents[1] / "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
