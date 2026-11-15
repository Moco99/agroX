"""Remote raster reads transfer bounded ranges and reuse cached blocks."""

from io import BytesIO
from pathlib import Path

import pytest

from app.config import Settings
from app.storage.block_cache import BlockCache
from app.storage.factory import build_store
from app.storage.ports import StoreUnavailableError
from app.storage.s3 import BLOCK_SIZE, RangeFile, S3Store


class FakeS3:
    def __init__(self) -> None:
        self.ranges: list[str] = []

    def get_object(self, **kwargs: object) -> dict[str, object]:
        self.ranges.append(str(kwargs["Range"]))
        return {"Body": BytesIO(b"x" * BLOCK_SIZE)}


def test_ranged_read_and_disk_cache(tmp_path: Path) -> None:
    client = FakeS3()
    store = S3Store(client, "test-placeholder", BlockCache(tmp_path, BLOCK_SIZE * 4))  # type: ignore[arg-type]
    reader = RangeFile(store, "test.tif", BLOCK_SIZE * 3, "etag")
    reader.seek(BLOCK_SIZE + 17)
    assert reader.read(100) == b"x" * 100
    assert client.ranges == [f"bytes={BLOCK_SIZE}-{BLOCK_SIZE * 2 - 1}"]
    second = RangeFile(store, "test.tif", BLOCK_SIZE * 3, "etag")
    second.seek(BLOCK_SIZE + 17)
    assert second.read(100) == b"x" * 100
    assert len(client.ranges) == 1


def test_explicit_s3_requires_configuration(tmp_path: Path) -> None:
    settings = Settings(data_mode="real", derived_dir=tmp_path, synthetic_seed=1, cors_origins=(), data_source="s3")
    with pytest.raises(StoreUnavailableError):
        build_store(settings)


def test_concurrent_cache_put_counts_each_block_once(tmp_path: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor

    cache = BlockCache(tmp_path, 1024)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: cache.put('same-key', 'etag', 0, b'x' * 600), range(20)))
    assert cache.get('same-key', 'etag', 0) == b'x' * 600
    assert cache.size_bytes() == 600
