"""LiveSoilProvider: SSURGO where it exists, SoilGrids 2.0 (ISRIC, 250 m) everywhere else.

The water balance needs available water capacity (AWC). SoilGrids publishes volumetric water content at
field capacity (wv0033, -33 kPa) and wilting point (wv1500, -1500 kPa); AWC is their difference averaged
over 0-100 cm, so no pedotransfer coefficients are invented. In the US pilot SSURGO (field scale) stays the
source and SoilGrids is reported as a cross-check; elsewhere SoilGrids feeds the twin as ESTIMATED.

SoilGrids is slow and rate limited (~5 requests/min), so it never blocks a response for long: queries go
through a BackgroundCache keyed by the ~250 m cell of the farm centre (farms and zones in the same cell share
one request), successes are kept for weeks, failures for minutes (negative cache), and while a cell is
pending or failed the twin runs on the provisional AWC, marked ESTIMATED with an explicit warning.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from app.providers.live.background import BackgroundCache, Lookup
from app.providers.live.parcel import centroid, zone_rings
from app.providers.ports import DataNotFoundError
from app.providers.real.soil import DEFAULT_ROOT_LIMIT_M, RealSoilProvider
from app.schemas.common import DataState, Provenance
from app.schemas.soil import SoilProfile

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
# Same fallback the Real* soil adapter uses when SSURGO has no AWC (decisions.md)
PROVISIONAL_AWC = 150.0
# SoilGrids standard depth intervals down to 1 m, with their thickness in cm for the weighted mean
DEPTHS_CM = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15, "30-60cm": 30, "60-100cm": 40}

# ─────────────────────────────────────────
# Section: Request policy (operational configuration, not science; ADR-024)
# ─────────────────────────────────────────

# ~250 m in latitude: cache-key grid that approximates the SoilGrids cell (the real grid is Homolosine)
CELL_DEG = 0.0025
# ISRIC asks for about 5 calls per minute: one call every 12 s per process
MIN_INTERVAL_S = 12.0
# First try right away, then back off; a cell that fails all three is negative-cached
RETRY_DELAYS_S = (0.0, 15.0, 45.0)
REQUEST_TIMEOUT_S = 25.0
# TOTAL wall-clock budget of one attempt: urllib's timeout is per socket operation, so a response that
# trickles in (or a stalled TLS/DNS step) can take minutes; past this the attempt is abandoned and retried
ATTEMPT_DEADLINE_S = 40.0
POSITIVE_TTL_S = 30 * 24 * 3600.0
NEGATIVE_TTL_S = 10 * 60.0
# The request that discovers a new cell waits this long for it; later requests never wait
FIRST_LOAD_WAIT_S = 8.0

SoilJson = dict[str, object]
Fetcher = Callable[[float, float], SoilJson]


def fetch_soilgrids(lon: float, lat: float) -> SoilJson:
    """One SoilGrids call (retries and spacing are the BackgroundCache's job)."""
    params = [("lon", lon), ("lat", lat), ("value", "mean"), ("property", "wv0033"), ("property", "wv1500")]
    params += [("depth", d) for d in DEPTHS_CM]
    url = f"{SOILGRIDS_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "agrox-backend"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
        data = json.loads(r.read())
    if not isinstance(data, dict):
        raise ValueError("SoilGrids: unexpected response")
    return data


def cell_key(lon: float, lat: float) -> str:
    """Stable key of the ~250 m cell that contains (lon, lat)."""
    return f"cell_{round(lat / CELL_DEG)}_{round(lon / CELL_DEG)}"


def unique_cells(points: dict[str, tuple[float, float]]) -> dict[str, list[str]]:
    """cell key -> ids of the (lon, lat) points that fall in it: one SoilGrids request per distinct cell."""
    out: dict[str, list[str]] = {}
    for pid, (lon, lat) in points.items():
        out.setdefault(cell_key(lon, lat), []).append(pid)
    return out


def awc_mm_per_m(data: SoilJson) -> float | None:
    """Depth-weighted (wv0033 - wv1500) over 0-100 cm, in mm of water per m of soil; None if any depth is missing."""
    props = data["properties"]
    assert isinstance(props, dict)
    layers = {lay["name"]: lay for lay in props["layers"]}
    total = 0.0
    for label, thickness in DEPTHS_CM.items():
        vals = []
        for name in ("wv0033", "wv1500"):
            lay = layers[name]
            depth = next(d for d in lay["depths"] if d["label"] == label)
            mean = depth["values"]["mean"]
            if mean is None:
                return None
            # d_factor turns the stored integer into 10^-2 cm3/cm3 (volume %)
            vals.append(mean / lay["unit_measure"]["d_factor"])
        # volume % difference * 10 = mm of water per m of soil
        total += (vals[0] - vals[1]) * 10 * thickness
    return round(total / sum(DEPTHS_CM.values()), 1)


class LiveSoilProvider(RealSoilProvider):
    def __init__(
        self,
        derived_dir: Path,
        cache_dir: Path,
        fetcher: Fetcher = fetch_soilgrids,
        *,
        wait_s: float = FIRST_LOAD_WAIT_S,
        attempt_deadline_s: float = ATTEMPT_DEADLINE_S,
        retry_delays_s: tuple[float, ...] = RETRY_DELAYS_S,
        min_interval_s: float = MIN_INTERVAL_S,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__(derived_dir)
        self._fetcher = fetcher
        self._wait_s = wait_s
        self._deadline_s = attempt_deadline_s
        # Runs the raw fetches so an attempt can be abandoned at its deadline without killing the thread
        self._io = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agrox-soilgrids-io")
        # One worker: SoilGrids calls are serialised anyway by the rate limit
        self._cache = BackgroundCache(
            cache_dir / "soilgrids",
            positive_ttl_s=POSITIVE_TTL_S,
            negative_ttl_s=NEGATIVE_TTL_S,
            retry_delays_s=retry_delays_s,
            min_interval_s=min_interval_s,
            workers=1,
            clock=clock,
            sleep=sleep,
        )

    # ─────────────────────────────────────────
    # Section: SoilGrids lookups
    # ─────────────────────────────────────────

    def _farm_cell(self, farm_id: str) -> tuple[str, float, float, list[str]]:
        """One request per farm at its centre: zones are 300 m wide, about one SoilGrids cell each, and the
        quota (5/min) would make four requests take a minute; zones sharing a cell share the cache entry."""
        rings = zone_rings(self._dir, farm_id)
        pts = [centroid(r) for r in rings.values()]
        lon, lat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        return cell_key(lon, lat), lon, lat, list(rings)

    def _fetch(self, key: str, lon: float, lat: float) -> Callable[[], dict[str, object]]:
        def result(data: SoilJson) -> dict[str, object]:
            return {"awc_mm_per_m": awc_mm_per_m(data), "lon": round(lon, 5), "lat": round(lat, 5)}

        def late(fut: Future[SoilJson]) -> None:
            # The attempt blew its deadline but the request finished later: keep the answer for next time
            if fut.cancelled() or fut.exception() is not None:
                return
            try:
                self._cache.store(key, result(fut.result()))
            except Exception:
                pass

        def run() -> dict[str, object]:
            fut = self._io.submit(self._fetcher, lon, lat)
            try:
                return result(fut.result(timeout=self._deadline_s))
            except TimeoutError:
                fut.add_done_callback(late)
                raise TimeoutError(f"SoilGrids gave no answer within {self._deadline_s:g} s") from None

        return run

    def lookup(self, farm_id: str, wait_s: float | None = None) -> Lookup:
        """Cached SoilGrids answer for the farm, starting a background fetch on a miss."""
        key, lon, lat, _ = self._farm_cell(farm_id)
        return self._cache.get(key, self._fetch(key, lon, lat), self._wait_s if wait_s is None else wait_s)

    def status(self, farm_id: str) -> Lookup | None:
        """Read-only status for the load contract (None = never requested)."""
        return self._cache.peek(self._farm_cell(farm_id)[0])

    def wait(self, farm_id: str, timeout_s: float) -> Lookup | None:
        return self._cache.wait(self._farm_cell(farm_id)[0], timeout_s)

    # ─────────────────────────────────────────
    # Section: Soil profiles per zone
    # ─────────────────────────────────────────

    def get_zone_soils(self, farm_id: str) -> dict[str, SoilProfile]:
        try:
            ssurgo = super().get_zone_soils(farm_id)
        except DataNotFoundError:
            ssurgo = {}
        found = self.lookup(farm_id)
        awc = found.value.get("awc_mm_per_m") if found.status == "ready" and found.value else None
        g = float(str(awc)) if isinstance(awc, int | float) else None
        if ssurgo:
            out: dict[str, SoilProfile] = {}
            for z, prof in ssurgo.items():
                if g is not None:
                    note = f"SoilGrids 250 m cross-check: AWC {g} mm/m vs SSURGO {prof.awc_mm_per_m}"
                else:
                    note = f"SoilGrids cross-check unavailable ({_reason(found)})"
                out[z] = prof.model_copy(update={"warnings": [*prof.warnings, note]})
            return out
        zones = list(zone_rings(self._dir, farm_id))
        if g is None:
            return self._provisional(farm_id, zones, found)
        return {
            zid: SoilProfile(
                awc_mm_per_m=g,
                root_depth_max_m=DEFAULT_ROOT_LIMIT_M,
                provenance=Provenance(
                    source="SoilGrids 2.0 (ISRIC) wv0033 - wv1500, 0-100 cm",
                    data_state=DataState.ESTIMATED,
                    resolution="250 m",
                    method="depth-weighted water content difference at -33 and -1500 kPa, at the farm centre cell",
                ),
                warnings=[
                    "SoilGrids is a 250 m model prediction (ESTIMATED), not a field survey",
                    f"no restrictive layer data: root limit {DEFAULT_ROOT_LIMIT_M} m assumed (DECLARED)",
                ],
            )
            for zid in zones
        }

    def _provisional(self, farm_id: str, zones: list[str], found: Lookup) -> dict[str, SoilProfile]:
        """No survey and no SoilGrids value yet: keep the twin runnable with the same provisional AWC as Real*."""
        if found.status == "running":
            note = (
                f"SoilGrids request in progress: provisional AWC {PROVISIONAL_AWC} mm/m (ESTIMATED); "
                f"poll /api/farms/{farm_id}/status and refresh when soil is ready"
            )
        elif found.status == "failed":
            note = (
                f"SoilGrids unavailable ({found.error}) after {found.attempts} attempt(s): provisional AWC "
                f"{PROVISIONAL_AWC} mm/m (ESTIMATED); automatic retry in {found.retry_after_s or 0:.0f} s"
            )
        else:
            note = (
                f"SoilGrids has no data for this cell (water, urban or rock?): provisional AWC "
                f"{PROVISIONAL_AWC} mm/m (ESTIMATED)"
            )
        return {
            zid: SoilProfile(
                awc_mm_per_m=PROVISIONAL_AWC,
                root_depth_max_m=DEFAULT_ROOT_LIMIT_M,
                provenance=Provenance(source="provisional default (SoilGrids pending)", data_state=DataState.ESTIMATED),
                warnings=[note],
            )
            for zid in zones
        }


def _reason(found: Lookup) -> str:
    if found.status == "running":
        return "SoilGrids request in progress"
    if found.status == "failed":
        return f"SoilGrids failed: {found.error}"
    return "SoilGrids has no data for this cell"


def is_soil_final(found: Lookup | None) -> bool:
    """True once SoilGrids answered (with a value or with an explicit no-data): nothing more will change."""
    return found is not None and found.status == "ready"
