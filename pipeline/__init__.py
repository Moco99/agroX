"""raw -> derived pipeline for the AGROX pilot farm.

Each build_* module is idempotent, needs no network and writes small artifacts
(JSON/CSV/PNG) into backend/app/data/derived/ plus an entry in manifest.json.
"""
