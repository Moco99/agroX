"""Isolate the standalone scraper behind a typed backend boundary."""

from __future__ import annotations

import importlib.util
import threading
from functools import lru_cache
from pathlib import Path
from typing import Protocol, cast

from app.storage.ports import StoreUnavailableError

_CAPACITY = threading.BoundedSemaphore(4)


class Consult(Protocol):
    def __call__(self, lat: float, lon: float, inicio: str, fin: str, usar_cache: bool = True) -> dict[str, object]: ...


@lru_cache(maxsize=1)
def _consult() -> Consult:
    path = Path(__file__).resolve().parents[4] / "scraper" / "punto.py"
    spec = importlib.util.spec_from_file_location("agrox_point_scraper", path)
    if spec is None or spec.loader is None:
        raise StoreUnavailableError("Point query provider unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(Consult, module.consultar)


def query(lat: float, lon: float, start: str, end: str, refresh: bool) -> dict[str, object]:
    if not _CAPACITY.acquire(blocking=False):
        raise StoreUnavailableError("Point query capacity exhausted; retry shortly")
    try:
        return _consult()(lat, lon, start, end, usar_cache=not refresh)
    finally:
        _CAPACITY.release()
