"""Isolate the standalone scraper behind a typed backend boundary."""

from __future__ import annotations

import importlib.util
import threading
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Protocol, cast

from app.storage.ports import StoreUnavailableError

_CAPACITY = threading.BoundedSemaphore(4)


class Consult(Protocol):
    def __call__(self, lat: float, lon: float, inicio: str, fin: str, usar_cache: bool = True) -> dict[str, object]: ...


@lru_cache(maxsize=1)
def _module() -> ModuleType:
    path = Path(__file__).resolve().parents[4] / "scraper" / "punto.py"
    spec = importlib.util.spec_from_file_location("agrox_point_scraper", path)
    if spec is None or spec.loader is None:
        raise StoreUnavailableError("Point query provider unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _consult() -> Consult:
    return cast(Consult, _module().consultar)


def land_cover(lat: float, lon: float) -> dict[str, object]:
    """Only the land-cover section of the scraper (WorldCover 2021 + IO LULC), ~2-5 s, global."""
    module = _module()
    result = module.cobertura(module._sesion(), lat, lon)
    if not isinstance(result, dict):
        raise ValueError("land cover: unexpected response")
    return cast(dict[str, object], result)


def query(lat: float, lon: float, start: str, end: str, refresh: bool) -> dict[str, object]:
    if not _CAPACITY.acquire(blocking=False):
        raise StoreUnavailableError("Point query capacity exhausted; retry shortly")
    try:
        return _consult()(lat, lon, start, end, usar_cache=not refresh)
    finally:
        _CAPACITY.release()
