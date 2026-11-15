"""Port and shared types for object access (raw mirror of data/raw, local or on S3).

Keys are always relative to the raw root (e.g. `sentinel2/<scene>_B04.tif`): the
S3 adapter prepends the `raw/` prefix, the local adapter resolves under data/raw.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Protocol

from rasterio.io import DatasetReader

# ─────────────────────────────────────────
# Section: Errors and value objects
# ─────────────────────────────────────────


class StoreUnavailableError(RuntimeError):
    """The active store cannot serve the request (network, credentials); the API maps it to 503."""


class ObjectNotFoundError(LookupError):
    """The key does not exist in the active store."""


@dataclass(frozen=True)
class ObjectInfo:
    key: str
    size: int


# ─────────────────────────────────────────
# Section: Transfer metering
# ─────────────────────────────────────────


@dataclass
class TransferStats:
    """Bytes really pulled over the network vs served from the disk cache, plus request count."""

    network_bytes: int = 0
    cache_bytes: int = 0
    requests: int = 0

    def add(self, network: int = 0, cache: int = 0, requests: int = 0) -> None:
        self.network_bytes += network
        self.cache_bytes += cache
        self.requests += requests


_current: ContextVar[TransferStats | None] = ContextVar("agrox_transfer", default=None)
_lock = threading.Lock()
PROCESS_TOTALS = TransferStats()


def record_transfer(network: int = 0, cache: int = 0, requests: int = 0) -> None:
    """Called by adapters on every ranged GET / cache hit; feeds the per-call and the process counters."""
    with _lock:
        PROCESS_TOTALS.add(network, cache, requests)
    current = _current.get()
    if current is not None:
        current.add(network, cache, requests)


@contextmanager
def measure_transfer() -> Iterator[TransferStats]:
    """Measure what one API call pulls from the store (context-local, safe under the threadpool)."""
    stats = TransferStats()
    token = _current.set(stats)
    try:
        yield stats
    finally:
        _current.reset(token)


# ─────────────────────────────────────────
# Section: Port
# ─────────────────────────────────────────


class ObjectStore(Protocol):
    @property
    def mode(self) -> str:
        """`s3` or `local`: where the last operation was actually served from."""
        ...

    def list_objects(self, prefix: str) -> list[ObjectInfo]: ...

    def exists(self, key: str) -> bool: ...

    def read_bytes(self, key: str) -> bytes: ...

    def open_raster(self, key: str) -> AbstractContextManager[DatasetReader]:
        """Open a GeoTIFF for windowed reads; remote stores fetch only the ranges that rasterio asks for."""
        ...
