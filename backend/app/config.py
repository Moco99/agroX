"""Runtime settings resolved from environment variables (no secrets involved)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DERIVED_DIR = APP_DIR / "data" / "derived"
# data/raw lives at the repository root (outside git); LocalStore mirrors the bucket's raw/ prefix
DEFAULT_RAW_DIR = APP_DIR.parents[1] / "data" / "raw"
# Preserve the live weather cache shared with the hashed object-block cache.
DEFAULT_CACHE_DIR = APP_DIR.parents[1] / "data" / "cache"
# Artifacts built for point farms (soil cells, land cover, imagery): git-ignored, bounded by live_cache_max_mb
DEFAULT_LIVE_CACHE_DIR = APP_DIR.parent / ".cache" / "live"


@dataclass(frozen=True)
class Settings:
    data_mode: str
    derived_dir: Path
    synthetic_seed: int
    cors_origins: tuple[str, ...]
    version: str = "0.1.0"
    # auto = S3 when configured and reachable, else local | s3 | local
    data_source: str = "auto"
    raw_dir: Path = DEFAULT_RAW_DIR
    cache_dir: Path = DEFAULT_CACHE_DIR
    cache_max_mb: int = 512
    # Bucket name and profile come only from the environment (the repo is public): never log or return them
    s3_bucket: str | None = None
    aws_profile: str | None = None
    aws_region: str = "us-east-1"
    live_cache_dir: Path = DEFAULT_LIVE_CACHE_DIR
    live_cache_max_mb: int = 256


def get_settings() -> Settings:
    """Read settings on each call so tests can flip AGROX_DATA_MODE without reloading modules."""
    mode = os.environ.get("AGROX_DATA_MODE", "real").strip().lower()
    if mode not in {"real", "synthetic", "live"}:
        mode = "real"
    derived = Path(os.environ.get("AGROX_DERIVED_DIR", str(DEFAULT_DERIVED_DIR)))
    seed = int(os.environ.get("AGROX_SYNTHETIC_SEED", "20261114"))
    origins = tuple(
        o.strip()
        for o in os.environ.get("AGROX_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if o.strip()
    )
    source = os.environ.get("AGROX_DATA_SOURCE", "auto").strip().lower()
    if source not in {"auto", "s3", "local"}:
        source = "auto"
    # Empty strings (e.g. exported by a Makefile) count as "not set"
    return Settings(
        data_mode=mode,
        derived_dir=derived,
        synthetic_seed=seed,
        cors_origins=origins,
        data_source=source,
        raw_dir=Path(os.environ.get("AGROX_RAW_DIR") or DEFAULT_RAW_DIR),
        cache_dir=Path(os.environ.get("AGROX_CACHE_DIR") or DEFAULT_CACHE_DIR),
        cache_max_mb=int(os.environ.get("AGROX_CACHE_MAX_MB") or 512),
        s3_bucket=os.environ.get("AGROX_S3_BUCKET") or None,
        aws_profile=os.environ.get("AWS_PROFILE") or None,
        aws_region=os.environ.get("AWS_REGION") or "us-east-1",
        live_cache_dir=Path(os.environ.get("AGROX_LIVE_CACHE_DIR") or DEFAULT_LIVE_CACHE_DIR),
        live_cache_max_mb=int(os.environ.get("AGROX_LIVE_CACHE_MAX_MB") or 256),
    )
