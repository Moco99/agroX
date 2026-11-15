"""Adapters over the derived artifacts produced by `pipeline/` (no network, read-only)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import cast

from app.schemas.common import DataState, Provenance


@lru_cache(maxsize=64)
def _read_json_cached(path: str, mtime_ns: int) -> object:
    # mtime is part of the cache key so a pipeline rebuild is picked up without restarting the server
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_json(path: Path) -> dict[str, object]:
    data = _read_json_cached(str(path), path.stat().st_mtime_ns)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: expected a JSON object")
    return cast(dict[str, object], data)


def manifest_entry(derived_dir: Path, artifact_id: str) -> dict[str, object]:
    manifest_path = derived_dir / "manifest.json"
    if not manifest_path.exists():
        return {}
    artifacts = read_json(manifest_path).get("artifacts")
    if not isinstance(artifacts, dict):
        return {}
    entry = artifacts.get(artifact_id)
    return cast(dict[str, object], entry) if isinstance(entry, dict) else {}


def provenance_from_manifest(derived_dir: Path, artifact_id: str, fallback_source: str, state: DataState) -> Provenance:
    """Build provenance from the manifest so the API reports exactly what the pipeline recorded."""
    entry = manifest_entry(derived_dir, artifact_id)
    source = entry.get("source")
    method = entry.get("method")
    resolution = entry.get("resolution")
    built_at = entry.get("built_at")
    return Provenance(
        source=str(source) if source else fallback_source,
        data_state=state,
        version=str(built_at) if built_at else None,
        resolution=str(resolution) if resolution else None,
        method=str(method) if method else None,
    )
