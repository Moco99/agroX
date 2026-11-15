"""LocalStore: the same keys served from the data/raw folder (works with no network at all)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import rasterio
from rasterio.io import DatasetReader

from app.storage.ports import ObjectInfo, ObjectNotFoundError


class LocalStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def mode(self) -> str:
        return "local"

    def _path(self, key: str) -> Path:
        path = (self._root / key).resolve()
        # Keys come from query-derived values: never let them climb out of the raw root
        if self._root.resolve() not in path.parents:
            raise ObjectNotFoundError(key)
        return path

    def list_objects(self, prefix: str) -> list[ObjectInfo]:
        if not self._root.exists():
            return []
        out: list[ObjectInfo] = []
        base = self._root
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            key = path.relative_to(base).as_posix()
            if key.startswith(prefix):
                out.append(ObjectInfo(key=key, size=path.stat().st_size))
        return out

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).is_file()
        except ObjectNotFoundError:
            return False

    def read_bytes(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise ObjectNotFoundError(key)
        return path.read_bytes()

    @contextmanager
    def open_raster(self, key: str) -> Iterator[DatasetReader]:
        path = self._path(key)
        if not path.is_file():
            raise ObjectNotFoundError(key)
        with rasterio.open(path) as src:
            yield src
