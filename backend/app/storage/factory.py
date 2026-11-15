"""Pick the active ObjectStore from settings; `auto` never breaks startup and falls back to local data."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from functools import lru_cache
from typing import TypeVar

try:
    from rasterio.io import DatasetReader
except ImportError:
    DatasetReader = object  # type: ignore

from app.config import Settings, get_settings
from app.storage.block_cache import BlockCache
from app.storage.local import LocalStore
from app.storage.ports import ObjectInfo, ObjectNotFoundError, ObjectStore, StoreUnavailableError
from app.storage.s3 import S3Store, make_client

log = logging.getLogger("agrox.storage")
T = TypeVar("T")
# After a failure S3 is not retried for this long, so an offline demo is not slowed by timeouts on every call
COOLDOWN_S = 60.0


class AutoStore:
    """S3 first when configured and healthy, local data/raw otherwise.

    `last_mode` reports where the latest successful operation was served from, and
    `s3_error` explains why S3 is not being used (without leaking the bucket name).
    """

    def __init__(self, remote: ObjectStore | None, local: ObjectStore, remote_required: bool = False) -> None:
        self._remote = remote
        self._local = local
        self._required = remote_required
        self._down_until = 0.0
        self._last_mode = "local"
        self.s3_error: str | None = None if remote else "S3 not configured (AGROX_S3_BUCKET unset)"
        self._lock = threading.Lock()

    @property
    def mode(self) -> str:
        return self._last_mode

    @property
    def configured(self) -> bool:
        return self._remote is not None

    def s3_available(self) -> bool:
        """Probe S3 (cheap list) respecting the cooldown; used by the catalog endpoint."""
        if self._remote is None:
            return False
        if isinstance(self._remote, S3Store):
            if time.monotonic() < self._down_until:
                return False
            try:
                self._remote.probe()
            except StoreUnavailableError as exc:
                self._mark_down(exc)
                return False
            self._mark_up()
            return True
        return True

    def _mark_down(self, exc: Exception) -> None:
        with self._lock:
            self._down_until = time.monotonic() + COOLDOWN_S
            self.s3_error = str(exc)
        log.warning("S3 unavailable, falling back to local data: %s", exc)

    def _mark_up(self) -> None:
        with self._lock:
            self._down_until = 0.0
            self.s3_error = None

    def _run(self, op: Callable[[ObjectStore], T]) -> T:
        remote = self._remote
        if remote is not None and time.monotonic() >= self._down_until:
            try:
                result = op(remote)
                self._mark_up()
                self._last_mode = "s3"
                return result
            except StoreUnavailableError as exc:
                if self._required:
                    raise
                self._mark_down(exc)
            except ObjectNotFoundError:
                if self._required:
                    raise
                # Missing remotely is not an outage: try the local mirror for this key only
        elif remote is not None and self._required:
            raise StoreUnavailableError(self.s3_error or "S3 unavailable")
        result_local = op(self._local)
        self._last_mode = "local"
        return result_local

    def list_objects(self, prefix: str) -> list[ObjectInfo]:
        return self._run(lambda s: s.list_objects(prefix))

    def exists(self, key: str) -> bool:
        def check(store: ObjectStore) -> bool:
            if not store.exists(key):
                raise ObjectNotFoundError(key)
            return True

        try:
            return self._run(check)
        except ObjectNotFoundError:
            return False

    def read_bytes(self, key: str) -> bytes:
        return self._run(lambda s: s.read_bytes(key))

    @contextmanager
    def open_raster(self, key: str) -> Iterator[DatasetReader]:
        # Only the *opening* decides the fallback: errors raised later by the caller's own reads must not
        # make the generator yield twice, so the remote dataset is entered through an ExitStack
        remote = self._remote
        if remote is not None and time.monotonic() >= self._down_until:
            stack = ExitStack()
            try:
                src = stack.enter_context(remote.open_raster(key))
            except StoreUnavailableError as exc:
                if self._required:
                    raise
                self._mark_down(exc)
            except ObjectNotFoundError:
                if self._required:
                    raise
            else:
                self._last_mode = "s3"
                try:
                    yield src
                finally:
                    stack.close()
                return
        elif remote is not None and self._required:
            raise StoreUnavailableError(self.s3_error or "S3 unavailable")
        with self._local.open_raster(key) as local_src:
            self._last_mode = "local"
            yield local_src


def build_store(settings: Settings) -> AutoStore:
    local = LocalStore(settings.raw_dir)
    if settings.data_source == "s3" and not settings.s3_bucket:
        raise StoreUnavailableError("S3 mode requires AGROX_S3_BUCKET")
    if settings.data_source == "local" or not settings.s3_bucket:
        store = AutoStore(None, local)
        if settings.data_source == "s3":
            store.s3_error = "AGROX_DATA_SOURCE=s3 but AGROX_S3_BUCKET is unset"
        elif settings.data_source == "local":
            store.s3_error = "AGROX_DATA_SOURCE=local"
        return store
    try:
        client = make_client(settings.aws_profile, settings.aws_region)
    except Exception as exc:  # noqa: BLE001 - a missing profile/credentials must never break startup
        if settings.data_source == "s3":
            raise StoreUnavailableError("S3 client could not be created") from exc
        store = AutoStore(None, local)
        store.s3_error = f"S3 client could not be created ({type(exc).__name__})"
        return store
    cache = BlockCache(settings.cache_dir, settings.cache_max_mb * 1024 * 1024)
    remote = S3Store(client, settings.s3_bucket, cache)
    return AutoStore(remote, local, remote_required=settings.data_source == "s3")


@lru_cache(maxsize=4)
def _cached(settings: Settings) -> AutoStore:
    return build_store(settings)


def get_store() -> AutoStore:
    return _cached(get_settings())
