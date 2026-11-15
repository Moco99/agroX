"""Shared fixtures: providers for both data modes and an API client per mode."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_DERIVED_DIR
from app.providers.factory import Providers, _build
from app.providers.real.weather import RealWeatherProvider

SEED = 20261114
REAL_AVAILABLE = RealWeatherProvider.is_available(DEFAULT_DERIVED_DIR)
requires_real = pytest.mark.skipif(not REAL_AVAILABLE, reason="derived/ not built (run `make derived`)")


def provider_sets() -> list[Providers]:
    sets = [_build("synthetic", Path(DEFAULT_DERIVED_DIR), SEED)]
    if REAL_AVAILABLE:
        sets.append(_build("real", Path(DEFAULT_DERIVED_DIR), SEED))
    return sets


@pytest.fixture(scope="session")
def synthetic() -> Providers:
    return _build("synthetic", Path(DEFAULT_DERIVED_DIR), SEED)


@pytest.fixture(scope="session")
def real() -> Providers:
    if not REAL_AVAILABLE:
        pytest.skip("derived/ not built")
    return _build("real", Path(DEFAULT_DERIVED_DIR), SEED)


@pytest.fixture(params=["real", "synthetic"])
def client(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    if request.param == "real" and not REAL_AVAILABLE:
        pytest.skip("derived/ not built")
    monkeypatch.setenv("AGROX_DATA_MODE", str(request.param))
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
