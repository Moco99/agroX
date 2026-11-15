"""S3Store: read-only access to the raw/ mirror through boto3, fetching only the byte ranges asked for.

Credentials come from boto3's default chain (AWS_PROFILE, env keys, SSO...). The adapter
only ever calls ListObjectsV2, HeadObject and GetObject: it has no write path by design.
"""

from __future__ import annotations

import io
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

import rasterio
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from rasterio._vsiopener import FileContainer
from rasterio.io import DatasetReader

from app.storage.block_cache import BlockCache
from app.storage.ports import ObjectInfo, ObjectNotFoundError, StoreUnavailableError, record_transfer

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

RAW_PREFIX = "raw/"
# 256 KiB: big enough to amortise GET latency over contiguous strips, small enough not to over-fetch a farm window
BLOCK_SIZE = 256 * 1024
# ETag lookups are cached briefly so a burst of windowed reads costs one HeadObject
ETAG_TTL_S = 300.0


def make_client(profile: str | None, region: str) -> S3Client:
    """Build a client with short timeouts so an offline machine fails fast instead of hanging the API."""
    import boto3

    session = boto3.Session(profile_name=profile, region_name=region)
    config = Config(connect_timeout=4, read_timeout=15, retries={"max_attempts": 2, "mode": "standard"})
    return session.client("s3", config=config)


class RangeFile(io.RawIOBase):
    """Seekable read-only view of an S3 object backed by block-aligned ranged GETs and the disk cache."""

    def __init__(self, store: S3Store, key: str, size: int, etag: str, memory: dict[int, bytes] | None = None) -> None:
        super().__init__()
        self._store = store
        self._key = key
        self._size = size
        self._etag = etag
        self._pos = 0
        # Shared across the re-opens GDAL performs (size probe, header read) so a block is fetched once
        self._memory: dict[int, bytes] = memory if memory is not None else {}

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self._pos = offset
        elif whence == io.SEEK_CUR:
            self._pos += offset
        else:
            self._pos = self._size + offset
        self._pos = max(self._pos, 0)
        return self._pos

    def _block(self, index: int) -> bytes:
        cached = self._memory.get(index)
        if cached is not None:
            return cached
        data = self._store.fetch_block(self._key, self._etag, index, self._size)
        self._memory[index] = data
        return data

    def readinto(self, buffer: Any) -> int:
        if self._pos >= self._size:
            return 0
        want = min(len(buffer), self._size - self._pos)
        out = bytearray()
        while len(out) < want:
            index, offset = divmod(self._pos + len(out), BLOCK_SIZE)
            block = self._block(index)
            out += block[offset : offset + (want - len(out))]
        buffer[: len(out)] = out
        self._pos += len(out)
        return len(out)


class _SingleObjectContainer(FileContainer):  # type: ignore[misc]
    """GDAL virtual filesystem exposing exactly one object.

    Reporting every probed path as a file (rasterio's default for a bare callable) makes GDAL "find"
    .aux.xml/.ovr/.msk sidecars and read the whole object for each; here only the real path exists.
    """

    def __init__(self, store: S3Store, key: str, size: int, etag: str) -> None:
        self.path = f"s3-range/{key}"
        self._store = store
        self._key = key
        self._etag = etag
        self._size = size
        self._memory: dict[int, bytes] = {}

    def open(self, path: str, mode: str = "rb", **kwds: object) -> RangeFile:
        if path != self.path:
            raise FileNotFoundError(path)
        return RangeFile(self._store, self._key, self._size, self._etag, self._memory)

    def isfile(self, path: str) -> bool:
        return path == self.path

    def isdir(self, path: str) -> bool:
        return False

    def ls(self, path: str) -> list[str]:
        return []

    def mtime(self, path: str) -> int:
        return 0

    def rm(self, path: str) -> None:
        return None

    def size(self, path: str) -> int:
        if path != self.path:
            raise FileNotFoundError(path)
        return self._size


class S3Store:
    def __init__(self, client: S3Client, bucket: str, cache: BlockCache | None = None) -> None:
        self._client = client
        self._bucket = bucket
        self._cache = cache
        self._etags: dict[str, tuple[float, str, int]] = {}
        self._lock = threading.Lock()

    @property
    def mode(self) -> str:
        return "s3"

    # ── errors ──

    @staticmethod
    def _translate(exc: Exception, key: str) -> Exception:
        if isinstance(exc, ClientError):
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return ObjectNotFoundError(key)
        return StoreUnavailableError(f"S3 request failed ({type(exc).__name__})")

    # ── port ──

    def probe(self) -> None:
        """Cheap reachability + credentials check (one ListObjectsV2 with MaxKeys=1)."""
        try:
            self._client.list_objects_v2(Bucket=self._bucket, Prefix=RAW_PREFIX, MaxKeys=1)
            record_transfer(requests=1)
        except (ClientError, BotoCoreError) as exc:
            raise self._translate(exc, RAW_PREFIX) from exc

    def list_objects(self, prefix: str) -> list[ObjectInfo]:
        out: list[ObjectInfo] = []
        token: str | None = None
        try:
            while True:
                kwargs: dict[str, Any] = {"Bucket": self._bucket, "Prefix": RAW_PREFIX + prefix}
                if token:
                    kwargs["ContinuationToken"] = token
                page = self._client.list_objects_v2(**kwargs)
                record_transfer(requests=1)
                for item in page.get("Contents", []):
                    key = item["Key"].removeprefix(RAW_PREFIX)
                    if key and not key.endswith("/"):
                        out.append(ObjectInfo(key=key, size=int(item["Size"])))
                if not page.get("IsTruncated"):
                    break
                token = page.get("NextContinuationToken")
        except (ClientError, BotoCoreError) as exc:
            raise self._translate(exc, prefix) from exc
        return out

    def _head(self, key: str) -> tuple[str, int]:
        now = time.monotonic()
        with self._lock:
            hit = self._etags.get(key)
        if hit and now - hit[0] < ETAG_TTL_S:
            return hit[1], hit[2]
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=RAW_PREFIX + key)
        except (ClientError, BotoCoreError) as exc:
            raise self._translate(exc, key) from exc
        record_transfer(requests=1)
        etag = str(head.get("ETag", "")).strip('"')
        size = int(head["ContentLength"])
        with self._lock:
            self._etags[key] = (now, etag, size)
        return etag, size

    def exists(self, key: str) -> bool:
        try:
            self._head(key)
        except ObjectNotFoundError:
            return False
        return True

    def fetch_block(self, key: str, etag: str, index: int, size: int) -> bytes:
        if self._cache is not None:
            cached = self._cache.get(key, etag, index)
            if cached is not None:
                record_transfer(cache=len(cached))
                return cached
        start = index * BLOCK_SIZE
        end = min(start + BLOCK_SIZE, size) - 1
        try:
            resp = self._client.get_object(
                Bucket=self._bucket, Key=RAW_PREFIX + key, Range=f"bytes={start}-{end}", IfMatch=etag
            )
            data = resp["Body"].read()
        except (ClientError, BotoCoreError) as exc:
            raise self._translate(exc, key) from exc
        record_transfer(network=len(data), requests=1)
        if self._cache is not None:
            self._cache.put(key, etag, index, data)
        return data

    def read_bytes(self, key: str) -> bytes:
        etag, size = self._head(key)
        reader = RangeFile(self, key, size, etag)
        return reader.read(size) or b""

    @contextmanager
    def open_raster(self, key: str) -> Iterator[DatasetReader]:
        etag, size = self._head(key)
        container = _SingleObjectContainer(self, key, size, etag)

        # rasterio.open(fileobj) would slurp the whole object into memory; the `opener` hook instead lets GDAL
        # pull only the strips of the requested window through RangeFile
        try:
            with rasterio.open(container.path, opener=container) as src:
                yield src
        except rasterio.errors.RasterioIOError as exc:
            # GDAL swallows the Python exception raised inside readinto: surface it as a store failure
            raise StoreUnavailableError(f"could not read raster {key}: {exc}") from exc
