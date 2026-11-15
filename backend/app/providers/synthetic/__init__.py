"""Synthetic adapters (seeded, deterministic, always labelled SYNTHETIC). Kept for tests and offline demos."""

from __future__ import annotations

import numpy as np

from app.providers.synthetic import params as P


def rng_for(seed: int, stream: str) -> np.random.Generator:
    """Independent stream per generator so adding one generator never changes another's output."""
    offset = sum(ord(ch) * (i + 1) for i, ch in enumerate(stream))
    return np.random.default_rng([seed, offset])


def source(name: str) -> str:
    return f"synthetic:{name}_{P.GENERATOR_VERSION}"
