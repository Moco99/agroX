"""Background fetch cache for slow, rate-limited sources (SoilGrids, land cover).

Why: SoilGrids (ISRIC) asks for ~5 requests/min and often times out. Fetching it inside the request made the
first farm load take 30-90 s and, because failures were not stored, every later load repeated the timeout.
This cache answers immediately from disk and, on a miss, fetches in a background thread:

- positive entries (the source answered) live `positive_ttl_s` (soil does not change: weeks);
- negative entries (every retry failed) live `negative_ttl_s` (minutes), so a down source costs nothing
  per request until the entry expires, and is then retried on the next request;
- retries use the `retry_delays_s` backoff; a process-wide `min_interval_s` spaces calls to respect quotas;
- one fetch per key at a time (single-flight), whatever the number of concurrent requests.

The caller decides what to serve while a key is pending (e.g. provisional soil marked ESTIMATED).
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

JsonValue = dict[str, object]
Fetch = Callable[[], JsonValue]
LookupStatus = Literal["ready", "running", "failed"]


@dataclass(frozen=True)
class Lookup:
    status: LookupStatus
    value: JsonValue | None = None
    error: str | None = None
    # Seconds until a failed key is retried (negative entry expiry)
    retry_after_s: float | None = None
    attempts: int = 0
    elapsed_s: float | None = None


@dataclass
class _Running:
    started: float
    attempts: int = 0
    future: Future[None] | None = None


class BackgroundCache:
    def __init__(
        self,
        directory: Path,
        *,
        positive_ttl_s: float,
        negative_ttl_s: float,
        retry_delays_s: tuple[float, ...] = (0.0,),
        min_interval_s: float = 0.0,
        workers: int = 1,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._dir = directory
        self._positive_ttl, self._negative_ttl = positive_ttl_s, negative_ttl_s
        self._delays = retry_delays_s or (0.0,)
        self._min_interval = min_interval_s
        self._clock, self._sleep = clock, sleep
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="agrox-bg")
        self._lock = threading.Lock()
        self._running: dict[str, _Running] = {}
        # Shared by every worker of this cache: the quota is per source, not per key
        self._last_call = 0.0
        self._rate_lock = threading.Lock()

    # ─────────────────────────────────────────
    # Section: Disk entries
    # ─────────────────────────────────────────

    def _path(self, key: str) -> Path:
        return self._dir / f"{key}.json"

    def _read(self, key: str) -> JsonValue | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            # A corrupt entry is treated as a miss and overwritten by the next fetch
            return None
        return doc if isinstance(doc, dict) else None

    def _write(self, key: str, doc: JsonValue) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = self._path(key).with_suffix(".part")
        tmp.write_text(json.dumps(doc), encoding="utf-8")
        tmp.replace(self._path(key))

    def _fresh(self, key: str) -> Lookup | None:
        """A positive or still-valid negative entry; None when the key must be (re)fetched."""
        doc = self._read(key)
        if doc is None:
            return None
        now = self._clock()
        saved = float(str(doc.get("saved_at", 0)))
        attempts = int(str(doc.get("attempts", 0)))
        if doc.get("status") == "ok" and now - saved < self._positive_ttl:
            value = doc.get("value")
            return Lookup("ready", value if isinstance(value, dict) else {}, attempts=attempts)
        if doc.get("status") == "failed" and now - saved < self._negative_ttl:
            return Lookup(
                "failed",
                error=str(doc.get("error")),
                retry_after_s=round(self._negative_ttl - (now - saved), 1),
                attempts=attempts,
            )
        return None

    # ─────────────────────────────────────────
    # Section: Fetch with backoff
    # ─────────────────────────────────────────

    def _respect_rate(self) -> None:
        with self._rate_lock:
            wait = self._last_call + self._min_interval - self._clock()
            if wait > 0:
                self._sleep(wait)
            self._last_call = self._clock()

    def _work(self, key: str, fetch: Fetch, run: _Running) -> None:
        error = "no attempt made"
        try:
            for delay in self._delays:
                if delay > 0:
                    self._sleep(delay)
                self._respect_rate()
                run.attempts += 1
                try:
                    value = fetch()
                except Exception as exc:
                    error = f"{type(exc).__name__}: {str(exc)[:160]}"
                    continue
                self._write(key, {"status": "ok", "value": value, "saved_at": self._clock(), "attempts": run.attempts})
                return
            self._write(key, {"status": "failed", "error": error, "saved_at": self._clock(), "attempts": run.attempts})
        finally:
            with self._lock:
                self._running.pop(key, None)

    # ─────────────────────────────────────────
    # Section: Public API
    # ─────────────────────────────────────────

    def peek(self, key: str) -> Lookup | None:
        """Status without starting any fetch: None when the key was never requested (or expired)."""
        fresh = self._fresh(key)
        if fresh is not None:
            return fresh
        with self._lock:
            run = self._running.get(key)
        if run is None:
            return None
        return Lookup("running", attempts=run.attempts, elapsed_s=round(self._clock() - run.started, 1))

    def get(self, key: str, fetch: Fetch, wait_s: float = 0.0) -> Lookup:
        """Cached value, or start a background fetch; waits up to `wait_s` only when this call started it.

        Calls that find a fetch already running return at once: a slow source must cost its wait once,
        not once per request.
        """
        fresh = self._fresh(key)
        if fresh is not None:
            return fresh
        started_here = False
        with self._lock:
            run = self._running.get(key)
            if run is None:
                run = _Running(started=self._clock())
                self._running[key] = run
                run.future = self._pool.submit(self._work, key, fetch, run)
                started_here = True
        if started_here and wait_s > 0 and run.future is not None:
            try:
                run.future.result(timeout=wait_s)
            except TimeoutError:
                pass
            fresh = self._fresh(key)
            if fresh is not None:
                return fresh
        return Lookup("running", attempts=run.attempts, elapsed_s=round(self._clock() - run.started, 1))

    def wait(self, key: str, timeout_s: float) -> Lookup | None:
        """Block until a running fetch for `key` ends (tests and the prepare job use it)."""
        with self._lock:
            run = self._running.get(key)
        if run is not None and run.future is not None:
            try:
                run.future.result(timeout=timeout_s)
            except TimeoutError:
                pass
        return self.peek(key)
