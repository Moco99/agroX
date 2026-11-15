"""Runtime settings resolved from environment variables (no secrets involved)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DERIVED_DIR = APP_DIR / "data" / "derived"


@dataclass(frozen=True)
class Settings:
    data_mode: str
    derived_dir: Path
    synthetic_seed: int
    cors_origins: tuple[str, ...]
    version: str = "0.1.0"


def get_settings() -> Settings:
    """Read settings on each call so tests can flip AGROX_DATA_MODE without reloading modules."""
    mode = os.environ.get("AGROX_DATA_MODE", "real").strip().lower()
    if mode not in {"real", "synthetic"}:
        mode = "real"
    derived = Path(os.environ.get("AGROX_DERIVED_DIR", str(DEFAULT_DERIVED_DIR)))
    seed = int(os.environ.get("AGROX_SYNTHETIC_SEED", "20261114"))
    origins = tuple(
        o.strip()
        for o in os.environ.get("AGROX_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if o.strip()
    )
    return Settings(data_mode=mode, derived_dir=derived, synthetic_seed=seed, cors_origins=origins)
