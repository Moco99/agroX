"""Twin use cases: simulate a farm (per zone) under a scenario, snapshot of one day, observed vs simulated."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

from app.engine import twin
from app.engine.calendar import suggested_planting, suggested_season
from app.engine.compare import compare_ndvi, compare_soil_moisture, expected_canopy_series
from app.engine.config import (
    DEFAULT_PLANTING_MMDD,
    IRRIGATION_RULES,
    MAX_SEASON_DAYS,
    SCENARIO_PRESETS,
    STRESS_CLASS_THRESHOLDS,
    STRESS_DAY_KS,
    stress_class_for,
)
from app.engine.monte_carlo import run_monte_carlo
from app.engine.scenarios import expand_scenario, perturb_series, resolve_irrigation
from app.providers.factory import Providers, weather_for
from app.providers.live.projection import FIRST_DAY as PROJECTION_FIRST_DAY
from app.providers.ports import DataNotFoundError, WeatherProvider
from app.schemas.common import DataState, Provenance, TwinLevel
from app.schemas.crops import CropCatalog, CropParams
from app.schemas.farm import Farm, FarmZone
from app.schemas.observations import ObservationSeries
from app.schemas.twin import (
    ComparisonMetrics,
    Discrepancy,
    FarmSummary,
    ModelSeasonOutcome,
    TwinScenario,
    TwinSimulateRequest,
    TwinSimulateResponse,
    TwinState,
    TwinStateResponse,
    ZoneResult,
    ZoneStateSnapshot,
)
from app.schemas.weather import WeatherSeries
from app.services import climate_projection, farm_load_service
from app.services.errors import InvalidRequestError
from app.services.farm_service import NDVI_LOADING_WARNING, latest_ndvi_by_zone, ndvi_ready
from app.services.weather_reference import analogue_weather

# Days of weather simulated before planting so the bare-soil bucket reaches a plausible state
SPIN_UP_DAYS = 30
MAX_MONTE_CARLO = 300

# ─────────────────────────────────────────
# Section: Helpers
# ─────────────────────────────────────────


def crop_for_year(zone: FarmZone, year: int, catalog: CropCatalog, declared: str | None = None) -> CropParams:
    """A declared crop wins; else CDL history gives the observed crop of each year; else the zone default."""
    hist = next((h for h in zone.cdl_history if h.year == year), None)
    if declared is not None:
        crop_id = declared
    else:
        crop_id = hist.crop_id if hist and catalog.get(hist.crop_id) else zone.crop_id
    crop = catalog.get(crop_id)
    if crop is None:
        raise InvalidRequestError(_unsupported(crop_id, zone.zone_id, catalog))
    return crop


def _unsupported(crop_id: str, zone_id: str, catalog: CropCatalog) -> str:
    available = ", ".join(c.crop_id for c in catalog.crops)
    return (
        f"crop '{crop_id}' of zone '{zone_id}' is not in {catalog.catalog_version} (available: {available}); "
        "other crops have no verified Kc/GDD parameters yet"
    )


def _crop_state(zone: FarmZone, year: int, declared: str | None) -> DataState:
    if declared is not None:
        return DataState.DECLARED
    return DataState.MEASURED if any(h.year == year for h in zone.cdl_history) else DataState.DECLARED


def _validate_period(
    weather: WeatherProvider, start: date, end: date, reference_year: int | None = None, projection: bool = False
) -> None:
    if end < start:
        raise InvalidRequestError("end must be on or after start")
    # One season per run; southern seasons cross 1 January, so the rule is a length, not a calendar year
    if (end - start).days + 1 > MAX_SEASON_DAYS:
        raise InvalidRequestError(f"period longer than one season ({MAX_SEASON_DAYS} days)")
    if projection:
        climate_projection.check_window(start, end)
        return
    if reference_year is not None:
        return
    cov_start, cov_end = weather.coverage()
    if start < cov_start or end > cov_end:
        raise InvalidRequestError(f"period {start}..{end} outside weather coverage {cov_start}..{cov_end}")


def _resolve_period(req: TwinSimulateRequest, pt: tuple[float, float] | None) -> tuple[date, date]:
    """Request period, or the suggested season: Apr-Oct 2024 for the pilot, latest complete one for pt_ farms."""
    if pt is None:
        default_start, default_end = date(2024, 4, 1), date(2024, 10, 31)
    else:
        default_start, default_end = suggested_season(pt[0], date.today())
    # A half-given period is completed with the suggestion; _validate_period rejects incoherent mixes (422)
    return req.start or default_start, req.end or default_end


def _plantings(
    req: TwinSimulateRequest,
    zones: list[FarmZone],
    crops: dict[str, CropParams],
    start: date,
    end: date,
    pt: tuple[float, float] | None,
) -> dict[str, tuple[date, DataState]]:
    """Planting date per zone: declared by zone_id, else by crop_id, else the calendar suggestion."""
    declared = req.planting_dates or {}
    out: dict[str, tuple[date, DataState]] = {}
    for z in zones:
        crop_id = crops[z.zone_id].crop_id
        if z.zone_id in declared:
            out[z.zone_id] = (declared[z.zone_id], DataState.DECLARED)
        elif crop_id in declared:
            out[z.zone_id] = (declared[crop_id], DataState.DECLARED)
        elif pt is None:
            # Pilot: documented US Midwest dates (ADR-018), declared assumptions of the demo; a window that opens
            # after that date and still contains it the next year (e.g. Nov-Nov) plants in the following year
            planting = twin.default_planting(crop_id, start.year, DEFAULT_PLANTING_MMDD)
            following = twin.default_planting(crop_id, start.year + 1, DEFAULT_PLANTING_MMDD)
            if planting < start and following <= end:
                planting = following
            out[z.zone_id] = (planting, DataState.DECLARED)
        else:
            # Same rule as the pilot: a suggestion that falls before the window (northern Nov-Nov run) would start
            # the crop already mature, so it moves to the next occurrence when the window still contains it
            planting = suggested_planting(crop_id, pt[0], start)
            following = planting.replace(year=planting.year + 1)
            if planting < start and following <= end:
                planting = following
            out[z.zone_id] = (planting, DataState.ESTIMATED)
    return out


def _declared_crops(req: TwinSimulateRequest) -> dict[str, str]:
    # crop_overrides is the frontend name of zone_crops; both mean DECLARED, the newer one wins
    return {**(req.zone_crops or {}), **(req.crop_overrides or {})}


def _validate_declared(req: TwinSimulateRequest, farm: Farm, catalog: CropCatalog) -> None:
    zone_ids = {z.zone_id for z in farm.zones}
    for zid, crop_id in _declared_crops(req).items():
        if zid not in zone_ids:
            raise DataNotFoundError(
                f"zone_crops/crop_overrides: unknown zone '{zid}' (zones: {', '.join(sorted(zone_ids))})"
            )
        if catalog.get(crop_id) is None:
            raise InvalidRequestError(_unsupported(crop_id, zid, catalog))
    crop_ids = {c.crop_id for c in catalog.crops}
    unknown = set(req.planting_dates or {}) - zone_ids - crop_ids
    if unknown:
        raise InvalidRequestError(
            f"planting_dates keys must be zone_ids or crop_ids; unknown: {', '.join(sorted(unknown))}"
        )


def _twin_level(p: Providers) -> TwinLevel:
    # Observations are compared but never fed back (no assimilation, no decision loop): the honest level with
    # real weather is SHADOW even when NDVI/SMAP comparisons exist (decision D-TWIN-05)
    return TwinLevel.DIGITAL_MODEL if p.mode == "synthetic" else TwinLevel.DIGITAL_SHADOW


def _output_state(weather: WeatherSeries) -> DataState:
    return (
        weather.provenance.data_state
        if weather.provenance.data_state in (DataState.SYNTHETIC, DataState.SIMULATED)
        else DataState.ESTIMATED
    )


def _zone_ndvi_points(series: ObservationSeries | None, zone_id: str) -> list[tuple[date, float]]:
    if series is None:
        return []
    return [(pt.date, pt.value) for pt in series.points if pt.zone_id == zone_id]


def _safe_series(p: Providers, farm_id: str, source_id: str) -> ObservationSeries | None:
    try:
        return p.observations.ndvi_series(farm_id, source_id)
    except DataNotFoundError:
        return None


def _safe_smap(p: Providers, farm_id: str) -> ObservationSeries | None:
    try:
        return p.observations.soil_moisture(farm_id)
    except DataNotFoundError:
        return None


def _scenario_dict(s: TwinScenario) -> dict[str, float | str | None]:
    return {
        "precip_factor": s.precip_factor,
        "temp_delta_c": s.temp_delta_c,
        "irrigation_level": s.irrigation_level.value if s.irrigation_level else None,
        "preset": s.preset,
    }


def _is_neutral(s: TwinScenario) -> bool:
    return s.precip_factor == 1.0 and s.temp_delta_c == 0.0 and s.irrigation_level is None


# ─────────────────────────────────────────
# Section: Simulation
# ─────────────────────────────────────────


def _run_zone(
    inputs: twin.SeasonInputs, scenario: TwinScenario, fork_date: date | None
) -> tuple[list[TwinState], list[TwinState]]:
    """(baseline, run under the scenario): the scenario forks from fork_date, or replays the whole season."""
    baseline = twin.run_season(inputs)
    if _is_neutral(scenario):
        return baseline, baseline
    anchor = next((s for s in baseline if s.date == fork_date), None) if fork_date else None
    return baseline, twin.fork(anchor, inputs, scenario)


def _model_outcome(
    model: str, inputs: twin.SeasonInputs, scenario: TwinScenario, req: TwinSimulateRequest, start: date, end: date
) -> ModelSeasonOutcome:
    _, states = _run_zone(inputs, scenario, req.fork_date)
    trimmed = [s for s in states if start <= s.date <= end]
    summary = twin.summarise(trimmed, inputs.crop, inputs.planting_date)
    outcome = twin.season_outcome(trimmed, inputs.crop, inputs.planting_date, summary)
    return ModelSeasonOutcome(
        model=model, status=outcome.status, stress_days=outcome.stress_days, season_precip_mm=summary.total_precip_mm
    )


def simulate(p: Providers, req: TwinSimulateRequest) -> TwinSimulateResponse:
    pt = farm_load_service.ensure_supported(p, req.farm_id)
    projection = climate_projection.wants_projection(req)
    weather_src = weather_for(p, req.farm_id)
    start, end = _resolve_period(req, pt)
    _validate_period(weather_src, start, end, req.reference_year, projection)
    try:
        scenario = expand_scenario(req.scenario)
    except ValueError as exc:
        raise InvalidRequestError(str(exc)) from exc
    if req.fork_date is not None and not (start <= req.fork_date <= end):
        raise InvalidRequestError("fork_date must lie inside start..end")
    farm = p.farm.get_farm(req.farm_id)
    catalog = p.catalog.get_catalog()
    _validate_declared(req, farm, catalog)
    zones = farm.zones
    if req.zone_ids:
        unknown = set(req.zone_ids) - {z.zone_id for z in zones}
        if unknown:
            raise DataNotFoundError(f"unknown zone(s): {', '.join(sorted(unknown))}")
        zones = [z for z in zones if z.zone_id in req.zone_ids]

    year = start.year
    declared_crops = _declared_crops(req)
    crops = {z.zone_id: crop_for_year(z, year, catalog, declared_crops.get(z.zone_id)) for z in zones}
    planting_info = _plantings(req, zones, crops, start, end, pt)
    plantings = {zid: d for zid, (d, _) in planting_info.items()}
    desired_start = min([start, *(d - timedelta(days=SPIN_UP_DAYS) for d in plantings.values())])
    proj: climate_projection.ProjectionRun | None = None
    if projection:
        assert req.projection is not None
        run_start = max(PROJECTION_FIRST_DAY, desired_start)
        lat, lon = pt if pt is not None else (farm.centroid.lat, farm.centroid.lon)
        proj = climate_projection.projected_weather(p, lat, lon, req.projection, run_start, start, end)
        weather = proj.series[proj.animated]
    else:
        cov_start, _ = weather_src.coverage()
        run_start = desired_start if req.reference_year is not None else max(cov_start, desired_start)
        weather = (
            analogue_weather(weather_src, run_start, end, req.reference_year, start.year)
            if req.reference_year is not None
            else weather_src.get_daily(run_start, end)
        )
    if not weather.days:
        raise InvalidRequestError("no weather days in the requested period")
    output_state = _output_state(weather)
    hypothetical_crop = bool(req.crop_overrides) and req.crop_override_state == "SIMULATED"
    if hypothetical_crop and output_state is not DataState.SYNTHETIC:
        output_state = DataState.SIMULATED
    warnings: list[str] = list(p.warnings) + list(weather.warnings) + (proj.warnings if proj else [])
    if run_start < start:
        warnings.append(f"spin-up from {run_start} (planting minus {SPIN_UP_DAYS} days); outputs trimmed to start")
    if req.start is None or req.end is None:
        warnings.append(f"period {start}..{end} = suggested season (no start/end in the request)")
    for zid, (planting, state) in planting_info.items():
        if not start <= planting <= end:
            warnings.append(f"{zid}: planting {planting} falls outside {start}..{end}: the zone stays bare soil")
        if state is DataState.ESTIMATED:
            warnings.append(f"{zid}: planting {planting} is a hemisphere calendar suggestion (ESTIMATED): declare it")
    s2_ready = ndvi_ready(p, req.farm_id)
    if req.reference_year is not None:
        warnings.append("La temporada usa clima histórico de referencia; no es un pronóstico ni observación futura.")
        warnings.append("No se compara esta simulación con observaciones. El último NDVI conserva su fecha real.")
    compare_observations = req.include_comparison and req.reference_year is None and not hypothetical_crop and not proj
    if compare_observations and not s2_ready:
        warnings.append(NDVI_LOADING_WARNING.format(farm_id=req.farm_id) + "; Sentinel-2 comparison skipped")
    modis = _safe_series(p, req.farm_id, "modis_ndvi") if compare_observations else None
    s2 = _safe_series(p, req.farm_id, "sentinel2") if compare_observations and s2_ready else None
    smap = _safe_smap(p, req.farm_id) if compare_observations else None
    latest, latest_series = latest_ndvi_by_zone(p, req.farm_id, end)
    results: list[ZoneResult] = []
    for zone in zones:
        crop = crops[zone.zone_id]
        inputs = twin.SeasonInputs(
            days=weather.days,
            soil=zone.soil,
            crop=crop,
            planting_date=plantings[zone.zone_id],
            lat=zone.centroid.lat,
            elevation_m=zone.terrain.elevation_mean_m or weather.elevation_m,
            irrigation_level=zone.irrigation_level,
            output_state=output_state,
        )
        baseline, states = _run_zone(inputs, scenario, req.fork_date)
        trimmed = [s for s in states if start <= s.date <= end]
        base_trim = [s for s in baseline if start <= s.date <= end]
        summary = twin.summarise(trimmed, crop, inputs.planting_date)

        discrepancies: list[Discrepancy] = []
        comparison: list[ComparisonMetrics] = []
        if compare_observations:
            # Observations are compared with the BASELINE run: a scenario is not what happened
            for series in (modis, s2):
                obs = _zone_ndvi_points(series, zone.zone_id)
                if series is None or not obs:
                    continue
                d, m = compare_ndvi(base_trim, crop, obs, series.source_id, series.provenance.data_state)
                discrepancies.extend(d)
                comparison.append(m)
            if smap is not None:
                obs_sm = [(pt.date, pt.value) for pt in smap.points]
                d, m = compare_soil_moisture(base_trim, obs_sm, "smap", smap.provenance.data_state)
                discrepancies.extend(d)
                comparison.append(m)
        point = latest.get(zone.zone_id)
        zone_warnings = [f"{w}" for w in zone.soil.warnings]
        if not crop.verified:
            zone_warnings.append(f"{crop.crop_id}: Kc/GDD parameters provisional (verified=false)")
        mc = None
        if req.monte_carlo and req.monte_carlo.n > 0:
            mc_inputs = inputs if _is_neutral(scenario) else _perturbed_inputs(inputs, scenario)
            mc = run_monte_carlo(mc_inputs, min(req.monte_carlo.n, MAX_MONTE_CARLO), req.monte_carlo.seed)
        zone_state = trimmed[-1].data_state if trimmed else output_state
        results.append(
            ZoneResult(
                zone_id=zone.zone_id,
                name=zone.name,
                crop_id=crop.crop_id,
                area_ha=zone.area_ha,
                planting_date=inputs.planting_date,
                crop_state=(
                    DataState.SIMULATED
                    if hypothetical_crop and zone.zone_id in (req.crop_overrides or {})
                    else _crop_state(zone, year, declared_crops.get(zone.zone_id))
                ),
                planting_state=planting_info[zone.zone_id][1],
                irrigation_level=resolve_irrigation(zone.irrigation_level, scenario),
                states=trimmed if req.include_states else [],
                summary=summary,
                ndvi=point.value if point else None,
                ndvi_date=point.date if point else None,
                ndvi_state=latest_series.provenance.data_state if (point and latest_series) else output_state,
                ndvi_source=latest_series.source_id if (point and latest_series) else None,
                discrepancies=discrepancies if req.include_states else [],
                comparison=comparison,
                expected_canopy=[
                    {"date": d.isoformat(), "value": round(v, 4)} for d, v in expected_canopy_series(base_trim, crop)
                ]
                if req.include_states
                else [],
                monte_carlo=mc,
                outcome=twin.season_outcome(trimmed, crop, inputs.planting_date, summary),
                projection_range=climate_projection.season_range(
                    [
                        _model_outcome(m, replace(inputs, days=series.days), scenario, req, start, end)
                        for m, series in sorted(proj.series.items())
                    ]
                )
                if proj
                else None,
                data_state=zone_state,
                warnings=zone_warnings,
            )
        )

    if not _is_neutral(scenario):
        warnings.append(
            "scenario = exploratory simulation (SIMULATED), not a forecast nor a yield prediction; "
            "RH, wind and radiation are kept as observed"
        )
    if any(not c.verified for c in catalog.crops):
        warnings.append("crop catalog values are provisional literature values (verified=false)")
    if smap is not None:
        warnings.extend(w for w in smap.warnings if "quality" in w)
    total_area = sum(r.area_ha for r in results) or 1.0
    mean_ks = sum(r.summary.mean_ks * r.area_ha for r in results) / total_area
    provenance: dict[str, Provenance] = {
        "weather": weather.provenance,
        "crops": catalog.provenance,
        **{f"farm_{k}": v for k, v in farm.provenance.items()},
        "twin": Provenance(
            source="AGROX twin_v1 (FAO-56 PM + water balance + GDD)",
            data_state=(DataState.SYNTHETIC if output_state is DataState.SYNTHETIC else DataState.SIMULATED)
            if not _is_neutral(scenario)
            else output_state,
            method="daily FAO-56 chapter 8 bucket per zone",
        ),
    }
    for series in (modis, s2, smap):
        if series is not None:
            provenance[f"obs_{series.source_id}"] = series.provenance
    if req.zone_crops or req.planting_dates or (req.crop_overrides and not hypothetical_crop):
        provenance["declared_inputs"] = Provenance(
            source="user request (zone_crops / crop_overrides / planting_dates)",
            data_state=DataState.DECLARED,
            method="declared by the user; not observed",
        )
    if hypothetical_crop:
        warnings.append("Cultivos de la rotación son hipotéticos: no representan cultivos declarados ni observados.")
        provenance["hypothetical_crop"] = Provenance(
            source="rotation scenario: hypothetical crop overrides",
            data_state=DataState.SIMULATED,
            method="scenario choice, not observed or declared in the parcel",
        )
    return TwinSimulateResponse(
        catalog_version=catalog.catalog_version,
        data_mode=p.mode,
        twin_level=TwinLevel.DIGITAL_MODEL
        if req.reference_year is not None or hypothetical_crop or proj
        else _twin_level(p),
        farm_id=farm.farm_id,
        start=start,
        end=end,
        scenario=req.scenario,
        scenario_expanded=_scenario_dict(scenario),
        zones=results,
        farm_summary=FarmSummary(
            area_ha=round(total_area, 2),
            mean_ks_area_weighted=round(mean_ks, 4),
            stress_class=stress_class_for(mean_ks),
            mean_soil_water_fraction=round(
                sum(r.summary.mean_soil_water_fraction * r.area_ha for r in results) / total_area, 4
            ),
            total_precip_mm=results[0].summary.total_precip_mm if results else 0.0,
            total_irrigation_mm=round(sum(r.summary.total_irrigation_mm * r.area_ha for r in results) / total_area, 1),
            note="area-weighted aggregate of independent zone runs; the farm has no state of its own",
        ),
        warnings=list(dict.fromkeys(warnings)),
        provenance=provenance,
        climate_projection=proj.info if proj else None,
    )


def _perturbed_inputs(inputs: twin.SeasonInputs, scenario: TwinScenario) -> twin.SeasonInputs:
    """Monte Carlo under a scenario: perturb the whole season's weather, keep parameter uncertainty."""
    return replace(
        inputs,
        days=perturb_series(inputs.days, scenario.precip_factor, scenario.temp_delta_c),
        irrigation_level=resolve_irrigation(inputs.irrigation_level, scenario),
        output_state=DataState.SIMULATED if inputs.output_state is not DataState.SYNTHETIC else DataState.SYNTHETIC,
    )


# ─────────────────────────────────────────
# Section: Snapshot of one day
# ─────────────────────────────────────────


# Keyed by providers identity (providers are cached per mode/derived dir/seed in the factory)
_BASELINE_CACHE: dict[tuple[int, str, int], TwinSimulateResponse] = {}


def baseline_year(p: Providers, farm_id: str, year: int) -> TwinSimulateResponse:
    """Whole-year baseline run (cached per providers instance) used by the state snapshot."""
    key = (id(p), farm_id, year)
    if key not in _BASELINE_CACHE:
        cov_start, cov_end = weather_for(p, farm_id).coverage()
        start = max(date(year, 1, 1), cov_start)
        end = min(date(year, 12, 31), cov_end)
        _BASELINE_CACHE[key] = simulate(
            p, TwinSimulateRequest(farm_id=farm_id, start=start, end=end, include_comparison=False)
        )
    return _BASELINE_CACHE[key]


def state_on(p: Providers, farm_id: str, day: date) -> TwinStateResponse:
    cov_start, cov_end = weather_for(p, farm_id).coverage()
    if not cov_start <= day <= cov_end:
        raise InvalidRequestError(f"date {day} outside weather coverage {cov_start}..{cov_end}")
    run = baseline_year(p, farm_id, day.year)
    latest, series = latest_ndvi_by_zone(p, farm_id, day)
    snapshots: list[ZoneStateSnapshot] = []
    for z in run.zones:
        state: TwinState | None = next((s for s in z.states if s.date == day), None)
        point = latest.get(z.zone_id)
        snapshots.append(
            ZoneStateSnapshot(
                zone_id=z.zone_id,
                name=z.name,
                crop_id=z.crop_id,
                area_ha=z.area_ha,
                state=state,
                stress_class=stress_class_for(state.ks) if state else z.summary.stress_class,
                ndvi=point.value if point else None,
                ndvi_date=point.date if point else None,
                ndvi_state=series.provenance.data_state if (point and series) else DataState.ESTIMATED,
            )
        )
    return TwinStateResponse(
        farm_id=farm_id,
        date=day,
        data_mode=run.data_mode,
        twin_level=run.twin_level,
        zones=snapshots,
        warnings=run.warnings,
        provenance=run.provenance,
    )


# ─────────────────────────────────────────
# Section: Product configuration exposed to the UI
# ─────────────────────────────────────────


def twin_config() -> dict[str, object]:
    """Every number here is product configuration (not science), listed so the UI can show its assumptions."""
    return {
        "irrigation_levels": {
            level.value: {"depth_mm": rule.depth_mm, "trigger_fraction_of_raw": rule.trigger_fraction_of_raw}
            for level, rule in IRRIGATION_RULES.items()
        },
        "presets": {
            name: {"precip_factor": pr.precip_factor, "temp_delta_c": pr.temp_delta_c, "description": pr.description_en}
            for name, pr in SCENARIO_PRESETS.items()
        },
        "stress_class_thresholds_mean_ks": [{"min_ks": t, "class": c.value} for t, c in STRESS_CLASS_THRESHOLDS],
        "stress_day_ks": STRESS_DAY_KS,
        "default_planting_mmdd": DEFAULT_PLANTING_MMDD,
        "note": "product configuration documented in docs/00-overview/decisions.md, not calibrated science",
    }
