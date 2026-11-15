"""Twin use cases: simulate a farm (per zone) under a scenario, snapshot of one day, observed vs simulated."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

from app.engine import twin
from app.engine.compare import compare_ndvi, compare_soil_moisture, expected_canopy_series
from app.engine.config import (
    DEFAULT_PLANTING_MMDD,
    IRRIGATION_RULES,
    SCENARIO_PRESETS,
    STRESS_CLASS_THRESHOLDS,
    STRESS_DAY_KS,
    stress_class_for,
)
from app.engine.monte_carlo import run_monte_carlo
from app.engine.scenarios import expand_scenario, perturb_series, resolve_irrigation
from app.providers.factory import Providers
from app.providers.ports import DataNotFoundError
from app.schemas.common import DataState, Provenance, TwinLevel
from app.schemas.crops import CropCatalog, CropParams
from app.schemas.farm import FarmZone
from app.schemas.observations import ObservationSeries
from app.schemas.twin import (
    ComparisonMetrics,
    Discrepancy,
    FarmSummary,
    TwinScenario,
    TwinSimulateRequest,
    TwinSimulateResponse,
    TwinState,
    TwinStateResponse,
    ZoneResult,
    ZoneStateSnapshot,
)
from app.schemas.weather import WeatherSeries
from app.services.errors import InvalidRequestError
from app.services.farm_service import latest_ndvi_by_zone

# Days of weather simulated before planting so the bare-soil bucket reaches a plausible state
SPIN_UP_DAYS = 30
MAX_MONTE_CARLO = 300

# ─────────────────────────────────────────
# Section: Helpers
# ─────────────────────────────────────────


def crop_for_year(zone: FarmZone, year: int, catalog: CropCatalog) -> CropParams:
    """CDL history gives the observed crop of each year; the 2024 majority is the fallback."""
    hist = next((h for h in zone.cdl_history if h.year == year), None)
    crop_id = hist.crop_id if hist and catalog.get(hist.crop_id) else zone.crop_id
    crop = catalog.get(crop_id)
    if crop is None:
        raise InvalidRequestError(f"crop '{crop_id}' of zone '{zone.zone_id}' is not in {catalog.catalog_version}")
    return crop


def _validate_period(p: Providers, start: date, end: date) -> None:
    if end < start:
        raise InvalidRequestError("end must be on or after start")
    if start.year != end.year:
        raise InvalidRequestError("start and end must fall in the same calendar year (one season per run)")
    cov_start, cov_end = p.weather.coverage()
    if start < cov_start or end > cov_end:
        raise InvalidRequestError(f"period {start}..{end} outside weather coverage {cov_start}..{cov_end}")


def _twin_level(p: Providers) -> TwinLevel:
    # Observations are compared but never fed back (no assimilation, no decision loop): the honest level with
    # real weather is SHADOW even when NDVI/SMAP comparisons exist (decision D-TWIN-05)
    return TwinLevel.DIGITAL_MODEL if p.mode == "synthetic" else TwinLevel.DIGITAL_SHADOW


def _output_state(weather: WeatherSeries) -> DataState:
    return DataState.SYNTHETIC if weather.provenance.data_state is DataState.SYNTHETIC else DataState.ESTIMATED


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


def simulate(p: Providers, req: TwinSimulateRequest) -> TwinSimulateResponse:
    _validate_period(p, req.start, req.end)
    try:
        scenario = expand_scenario(req.scenario)
    except ValueError as exc:
        raise InvalidRequestError(str(exc)) from exc
    if req.fork_date is not None and not (req.start <= req.fork_date <= req.end):
        raise InvalidRequestError("fork_date must lie inside start..end")
    farm = p.farm.get_farm(req.farm_id)
    catalog = p.catalog.get_catalog()
    zones = farm.zones
    if req.zone_ids:
        unknown = set(req.zone_ids) - {z.zone_id for z in zones}
        if unknown:
            raise DataNotFoundError(f"unknown zone(s): {', '.join(sorted(unknown))}")
        zones = [z for z in zones if z.zone_id in req.zone_ids]

    year = req.start.year
    plantings = {
        z.zone_id: (req.planting_dates or {}).get(crop_for_year(z, year, catalog).crop_id)
        or twin.default_planting(crop_for_year(z, year, catalog).crop_id, year, DEFAULT_PLANTING_MMDD)
        for z in zones
    }
    cov_start, _ = p.weather.coverage()
    run_start = max(cov_start, min([req.start, *(d - timedelta(days=SPIN_UP_DAYS) for d in plantings.values())]))
    weather = p.weather.get_daily(run_start, req.end)
    if not weather.days:
        raise InvalidRequestError("no weather days in the requested period")
    output_state = _output_state(weather)
    warnings: list[str] = list(p.warnings) + list(weather.warnings)
    if run_start < req.start:
        warnings.append(f"spin-up from {run_start} (planting minus {SPIN_UP_DAYS} days); outputs trimmed to start")

    modis = _safe_series(p, req.farm_id, "modis_ndvi") if req.include_comparison else None
    s2 = _safe_series(p, req.farm_id, "sentinel2") if req.include_comparison else None
    smap = _safe_smap(p, req.farm_id) if req.include_comparison else None
    latest, latest_series = latest_ndvi_by_zone(p, req.farm_id, req.end)
    results: list[ZoneResult] = []
    for zone in zones:
        crop = crop_for_year(zone, year, catalog)
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
        baseline = twin.run_season(inputs)
        if _is_neutral(scenario):
            states = baseline
        else:
            anchor = next((s for s in baseline if s.date == req.fork_date), None) if req.fork_date else None
            states = twin.fork(anchor, inputs, scenario)
        trimmed = [s for s in states if req.start <= s.date <= req.end]
        base_trim = [s for s in baseline if req.start <= s.date <= req.end]
        summary = twin.summarise(trimmed, crop, inputs.planting_date)

        discrepancies: list[Discrepancy] = []
        comparison: list[ComparisonMetrics] = []
        if req.include_comparison:
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
                    {"date": d.isoformat(), "value": round(v, 4)}
                    for d, v in expected_canopy_series(base_trim, crop)
                ]
                if req.include_states
                else [],
                monte_carlo=mc,
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
            data_state=DataState.SIMULATED if not _is_neutral(scenario) else output_state,
            method="daily FAO-56 chapter 8 bucket per zone",
        ),
    }
    for series in (modis, s2, smap):
        if series is not None:
            provenance[f"obs_{series.source_id}"] = series.provenance
    return TwinSimulateResponse(
        catalog_version=catalog.catalog_version,
        data_mode=p.mode,
        twin_level=_twin_level(p),
        farm_id=farm.farm_id,
        start=req.start,
        end=req.end,
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
        cov_start, cov_end = p.weather.coverage()
        start = max(date(year, 1, 1), cov_start)
        end = min(date(year, 12, 31), cov_end)
        _BASELINE_CACHE[key] = simulate(
            p, TwinSimulateRequest(farm_id=farm_id, start=start, end=end, include_comparison=False)
        )
    return _BASELINE_CACHE[key]


def state_on(p: Providers, farm_id: str, day: date) -> TwinStateResponse:
    cov_start, cov_end = p.weather.coverage()
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
