"""Staged loading of a farm (load contract, ADR-024): start slow sources in the background, report progress.

The first load of a point farm touches six slow, independent sources (DEM, SoilGrids, POWER, Sentinel-2
NDVI series, land cover, imagery). Instead of one 30-90 s request, `prepare` starts each stage in a worker
thread and returns at once; `status` reports per-stage progress so the UI can show it and refresh the farm
and the twin when the soil turns final. Every stage writes the same caches the endpoints read, so once a
stage is `ready` its endpoint answers from disk.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from app.providers.factory import POINT_FARMS_NEED_LIVE, Providers, weather_for
from app.providers.live.background import Lookup
from app.providers.live.parcel import point_farm
from app.providers.ports import DataNotFoundError
from app.schemas.common import DataState
from app.schemas.load import FarmLoadStatus, LoadStage, StageName, StageStatus

# Thread stages that failed are retried by the next prepare call after this many seconds
RETRY_FAILED_AFTER_S = 60.0
POLL_INTERVAL_S = 2.0
PILOT_FARM_ID = "story_pilot_farm"
FINAL: set[StageStatus] = {"ready", "provisional", "failed", "skipped"}

# (stage, required for "ready") in the order the UI shows them; imagery and land cover are optional
POINT_STAGES: list[tuple[StageName, bool]] = [
    ("terrain", True),
    ("soil", True),
    ("weather", True),
    ("ndvi", False),
    ("land_cover", False),
    ("basemap", False),
    ("heightmap", False),
]
PILOT_LIVE_STAGES: list[tuple[StageName, bool]] = [("soil", True), ("weather", True), ("ndvi", False)]


@dataclass
class _Run:
    status: StageStatus = "pending"
    started: float | None = None
    finished: float | None = None
    message: str | None = None
    attempts: int = 0


_JOBS: dict[tuple[int, str], dict[StageName, _Run]] = {}
_JOBS_LOCK = threading.Lock()
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="agrox-load")


# ─────────────────────────────────────────
# Section: Guards
# ─────────────────────────────────────────


def ensure_supported(p: Providers, farm_id: str) -> tuple[float, float] | None:
    """(lat, lon) of a point farm, None for the pilot; 422 for a bad pt_ id, 404 for an unknown id or outside live."""
    pt = point_farm(farm_id)
    if pt is None and farm_id != PILOT_FARM_ID:
        raise DataNotFoundError(f"unknown farm '{farm_id}'")
    if pt is not None and not p.any_parcel_supported:
        raise DataNotFoundError(POINT_FARMS_NEED_LIVE)
    return pt


# ─────────────────────────────────────────
# Section: Stage runners (each one fills the cache its endpoint reads)
# ─────────────────────────────────────────


def _runner(p: Providers, farm_id: str, stage: StageName) -> Callable[[], str | None]:
    def terrain() -> str | None:
        farm = p.farm.get_farm(farm_id)
        missing = [z.zone_id for z in farm.zones if z.terrain.elevation_mean_m is None]
        if missing:
            raise RuntimeError(f"Copernicus DEM unavailable for {', '.join(missing)}")
        return None

    def weather() -> str | None:
        start, end = weather_for(p, farm_id).coverage()
        return f"NASA POWER {start}..{end}"

    def ndvi() -> str | None:
        series = p.observations.ndvi_series(farm_id, "sentinel2")
        failed = [w for w in series.warnings if "API failed" in w]
        if failed:
            raise RuntimeError(failed[0])
        return f"{len({pt.date for pt in series.points})} clear Sentinel-2 dates"

    def basemap() -> str | None:
        assert p.point_imagery is not None
        _, info = p.point_imagery.basemap(farm_id)
        return f"{info.get('source')} (latest {info.get('acquired')})"

    def heightmap() -> str | None:
        assert p.point_imagery is not None
        doc = p.point_imagery.heightmap(farm_id)
        return f"Copernicus DEM {doc.get('width')}x{doc.get('height')} cells, {doc.get('min_m')}-{doc.get('max_m')} m"

    runners: dict[str, Callable[[], str | None]] = {
        "terrain": terrain,
        "weather": weather,
        "ndvi": ndvi,
        "basemap": basemap,
        "heightmap": heightmap,
    }
    return runners[stage]


def _execute(run: _Run, fn: Callable[[], str | None]) -> None:
    try:
        run.message = fn()
        run.status = "ready"
    except Exception as exc:
        run.status = "failed"
        run.message = f"{type(exc).__name__}: {str(exc)[:200]}"
    finally:
        run.finished = time.time()


# ─────────────────────────────────────────
# Section: Stages backed by a BackgroundCache (soil, land cover)
# ─────────────────────────────────────────


def _soil_stage(p: Providers, farm_id: str, pt: tuple[float, float] | None, trigger: bool) -> LoadStage:
    if pt is None:
        # Pilot: SSURGO from derived/ is the soil; SoilGrids is only a cross-check and never blocks
        return LoadStage(stage="soil", status="ready", required=True, message="SSURGO (derived/)",
                         data_state=DataState.MEASURED)
    assert p.live_soil is not None
    found = p.live_soil.lookup(farm_id, wait_s=0.0) if trigger else p.live_soil.status(farm_id)
    return _lookup_stage("soil", True, found, "SoilGrids 2.0 AWC", provisional_when_failed=True)


def _land_cover_stage(p: Providers, pt: tuple[float, float] | None, trigger: bool) -> LoadStage:
    if pt is None or p.land_cover is None:
        return LoadStage(stage="land_cover", status="skipped", required=False, message="pilot parcel from CDL")
    found = p.land_cover.lookup(*pt) if trigger else p.land_cover.status(*pt)
    return _lookup_stage("land_cover", False, found, "WorldCover 2021 + IO LULC", provisional_when_failed=False)


def _lookup_stage(
    stage: StageName, required: bool, found: Lookup | None, source: str, provisional_when_failed: bool
) -> LoadStage:
    if found is None:
        return LoadStage(stage=stage, status="pending", required=required)
    if found.status == "running":
        return LoadStage(
            stage=stage,
            status="running",
            required=required,
            message=f"{source}: attempt {max(found.attempts, 1)}",
            elapsed_s=found.elapsed_s,
            attempts=found.attempts,
        )
    if found.status == "failed":
        status: StageStatus = "provisional" if provisional_when_failed else "failed"
        stand_in = "; provisional value in use (ESTIMATED)" if provisional_when_failed else ""
        return LoadStage(
            stage=stage,
            status=status,
            required=required,
            message=f"{source} failed ({found.error}){stand_in}",
            retry_after_s=found.retry_after_s,
            attempts=found.attempts,
            data_state=DataState.ESTIMATED if provisional_when_failed else None,
        )
    value = found.value or {}
    if stage == "soil" and value.get("awc_mm_per_m") is None:
        return LoadStage(stage=stage, status="provisional", required=required, attempts=found.attempts,
                         message=f"{source}: no data in this cell; provisional value in use",
                         data_state=DataState.ESTIMATED)
    return LoadStage(stage=stage, status="ready", required=required, message=source, attempts=found.attempts,
                     data_state=DataState.ESTIMATED)


# ─────────────────────────────────────────
# Section: Public API
# ─────────────────────────────────────────


def _stage_list(pt: tuple[float, float] | None) -> list[tuple[StageName, bool]]:
    return POINT_STAGES if pt is not None else PILOT_LIVE_STAGES


def prepare(p: Providers, farm_id: str) -> FarmLoadStatus:
    """Start every missing (or failed long enough ago) stage in the background and return the status."""
    pt = ensure_supported(p, farm_id)
    if p.mode != "live":
        return status(p, farm_id)
    key = (id(p), farm_id)
    now = time.time()
    with _JOBS_LOCK:
        runs = _JOBS.setdefault(key, {})
        for stage, _ in _stage_list(pt):
            if stage in ("soil", "land_cover"):
                continue
            run = runs.get(stage)
            stale = run is not None and run.status == "failed" and now - (run.finished or now) > RETRY_FAILED_AFTER_S
            if run is None or stale:
                run = _Run(status="running", started=now, attempts=(run.attempts if run else 0) + 1)
                runs[stage] = run
                _POOL.submit(_execute, run, _runner(p, farm_id, stage))
    return status(p, farm_id, trigger=True)


def status(p: Providers, farm_id: str, trigger: bool = True) -> FarmLoadStatus:
    """Per-stage progress. `trigger` lets soil/land cover retry by themselves once their negative cache expires."""
    pt = ensure_supported(p, farm_id)
    if p.mode != "live":
        return FarmLoadStatus(farm_id=farm_id, data_mode=p.mode, state="ready", progress=1.0, soil_final=True,
                              stages=[], warnings=[f"{p.mode} mode: every source is served from disk, no staged load"])
    with _JOBS_LOCK:
        runs = dict(_JOBS.get((id(p), farm_id), {}))
    # A GET on a farm nobody prepared must not start SoilGrids/land-cover requests by itself
    trigger = trigger and bool(runs)
    now = time.time()
    stages: list[LoadStage] = []
    for stage, required in _stage_list(pt):
        if stage == "soil":
            stages.append(_soil_stage(p, farm_id, pt, trigger))
        elif stage == "land_cover":
            stages.append(_land_cover_stage(p, pt, trigger))
        else:
            run = runs.get(stage)
            if run is None:
                stages.append(LoadStage(stage=stage, status="pending", required=required))
                continue
            end = run.finished or now
            stages.append(
                LoadStage(
                    stage=stage,
                    status=run.status,
                    required=required,
                    message=run.message,
                    elapsed_s=round(end - run.started, 1) if run.started else None,
                    attempts=run.attempts,
                )
            )
    done = sum(1 for s in stages if s.status in FINAL)
    soil = next(s for s in stages if s.stage == "soil")
    loading = any(s.required and s.status not in FINAL for s in stages)
    failed = [s for s in stages if s.status == "failed"]
    started = bool(runs) or any(s.status != "pending" for s in stages)
    busy = any(s.status in ("running", "pending") for s in stages)
    return FarmLoadStatus(
        farm_id=farm_id,
        data_mode=p.mode,
        state="loading" if loading and started else ("not_started" if not started else "ready"),
        progress=round(done / len(stages), 3) if stages else 1.0,
        soil_final=soil.status == "ready" or (soil.status == "provisional" and soil.retry_after_s is None),
        stages=stages,
        poll_after_s=POLL_INTERVAL_S if busy else None,
        failed_stages=[s.stage for s in failed],
        warnings=[f"{s.stage} failed: {s.message}" for s in failed if s.required],
    )
