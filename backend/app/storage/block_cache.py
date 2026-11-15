"""Disk cache of fixed-size object blocks, keyed by (object key, ETag, block index).

Because the ETag is part of the key, an object that changes in the bucket is never
served stale; old blocks simply age out when the size cap is exceeded.
"""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path


class BlockCache:
    def __init__(self, root: Path, max_bytes: int) -> None:
        self._root = root
        self._max = max_bytes
        self._lock = threading.Lock()
        self._size: int | None = None

    def _path(self, key: str, etag: str, index: int) -> Path:
        digest = hashlib.sha256(f"{key}|{etag}".encode()).hexdigest()[:24]
        return self._root / digest[:2] / f"{digest}_{index}.blk"

    def get(self, key: str, etag: str, index: int) -> bytes | None:
        if self._max <= 0:
            return None
        path = self._path(key, etag, index)
        try:
            data = path.read_bytes()
            # Touch so eviction removes the least recently used blocks first
            path.touch()
            return data
        except OSError:
            return None

    def put(self, key: str, etag: str, index: int, data: bytes) -> None:
        if self._max <= 0:
            return
        path = self._path(key, etag, index)
        # Serialize the replace and accounting so simultaneous identical blocks
        # cannot race over a shared temporary path or count the same bytes twice.
        with self._lock:
            try:
                self._size = self._scan()
                old_size = path.stat().st_size if path.exists() else 0
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(path)
                self._size += len(data) - old_size
                if self._size > self._max:
                    self._evict()
            except OSError:
                # A full or read-only disk must not fail a data request.
                self._size = None
                return

    def _scan(self) -> int:
        return sum(p.stat().st_size for p in self._root.rglob("*.blk")) if self._root.exists() else 0

    def _evict(self) -> None:
        files = sorted(self._root.rglob("*.blk"), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        # Evict down to 80 % of the cap so we do not rescan on every put
        target = int(self._max * 0.8)
        for path in files:
            if total <= target:
                break
            try:
                total -= path.stat().st_size
                path.unlink()
            except OSError:
                continue
        self._size = max(total, 0)

    def size_bytes(self) -> int:
        with self._lock:
            self._size = self._scan()
            return self._size
