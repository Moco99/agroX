"""Land cover at a point (is it cropland?) for the "this point does not look like a field" warning.

Reuses the scraper's WorldCover 2021 + Impact Observatory LULC query through a BackgroundCache, so the farm
endpoint never waits on it: the first request starts it, later ones read the answer from disk.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from app.providers.live.background import BackgroundCache, Lookup
from app.providers.points import land_cover

Fetcher = Callable[[float, float], dict[str, object]]

# Land cover maps are yearly products: a month of cache is plenty; failures retried after 10 min
POSITIVE_TTL_S = 30 * 24 * 3600.0
NEGATIVE_TTL_S = 10 * 60.0


class LandCoverProvider:
    def __init__(
        self,
        cache_dir: Path,
        fetcher: Fetcher = land_cover,
        *,
        retry_delays_s: tuple[float, ...] = (0.0, 5.0),
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._fetcher = fetcher
        self._cache = BackgroundCache(
            cache_dir / "land_cover",
            positive_ttl_s=POSITIVE_TTL_S,
            negative_ttl_s=NEGATIVE_TTL_S,
            retry_delays_s=retry_delays_s,
            workers=2,
            clock=clock,
            sleep=sleep,
        )

    @staticmethod
    def _key(lat: float, lon: float) -> str:
        return f"lc_{lat:.4f}_{lon:.4f}"

    def lookup(self, lat: float, lon: float, wait_s: float = 0.0) -> Lookup:
        return self._cache.get(self._key(lat, lon), lambda: self._fetcher(lat, lon), wait_s)

    def status(self, lat: float, lon: float) -> Lookup | None:
        return self._cache.peek(self._key(lat, lon))

    def wait(self, lat: float, lon: float, timeout_s: float) -> Lookup | None:
        return self._cache.wait(self._key(lat, lon), timeout_s)
