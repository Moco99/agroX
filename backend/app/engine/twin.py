"""Daily twin: run_season / fork / summarise (docs/02-modules/digital-twin-engine.md)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

from app.engine import phenology, water_balance
from app.engine.config import (
    BARE_SOIL_DEPTH_M,
    FROST_T_MIN_C,
    INITIAL_DEPLETION_FRACTION,
    KC_BARE_SOIL,
    STRESS_DAY_KS,
    stress_class_for,
)
from app.engine.et0 import daily_et0
from app.engine.scenarios import perturb_series, resolve_irrigation
from app.schemas.common import DataState, IrrigationLevel, PhenoStage
from app.schemas.crops import CropParams
from app.schemas.soil import SoilProfile
from app.schemas.twin import SeasonOutcome, StageDates, TwinScenario, TwinState, ZoneSummary
from app.schemas.weather import WeatherDay


@dataclass(frozen=True)
class SeasonInputs:
    days: list[WeatherDay]
    soil: SoilProfile
    crop: CropParams
    planting_date: date
    lat: float
    elevation_m: float
    irrigation_level: IrrigationLevel
    # Data state of the *inputs* decides the state of the outputs (SYNTHETIC propagates)
    output_state: DataState = DataState.ESTIMATED
    initial_depletion_mm: float | None = None


@dataclass(frozen=True)
class _Carry:
    """Mutable-by-replacement loop state so run_season and fork share one daily loop."""

    gdd_cum: float
    planted: bool
    depletion_mm: float | None


# ─────────────────────────────────────────
# Section: Daily loop
# ─────────────────────────────────────────


def _loop(
    days: list[WeatherDay], inputs: SeasonInputs, carry: _Carry, output_state: DataState
) -> tuple[list[TwinState], _Carry]:
    """ET0 -> GDD -> stage -> Kc -> root depth -> water balance -> TwinState, day by day.

    Returns the unrounded carry too: TwinState values are rounded for the API, and resuming a fork from
    rounded numbers would make a neutral fork drift from run_season.
    """
    crop = inputs.crop
    soil = inputs.soil
    max_root = min(crop.root_depth_max_m, soil.root_depth_max_m)
    gdd_cum, planted, depletion = carry.gdd_cum, carry.planted, carry.depletion_mm
    states: list[TwinState] = []
    for day in days:
        if not planted and day.date >= inputs.planting_date:
            planted = True
            gdd_cum = 0.0
        et0 = daily_et0(
            day.t_max,
            day.t_min,
            day.rh_mean,
            day.solar_rad,
            day.wind_2m,
            inputs.lat,
            inputs.elevation_m,
            day.date.timetuple().tm_yday,
            day.t_mean,
        )
        gdd_day = phenology.daily_gdd(day.t_max, day.t_min, crop.t_base_gdd, crop.t_cap_gdd) if planted else 0.0
        # Once harvested the crop no longer accumulates heat units
        if phenology.stage_from_gdd(gdd_cum, crop, planted) is PhenoStage.HARVESTED:
            gdd_day = 0.0
        gdd_cum += gdd_day
        stage = phenology.stage_from_gdd(gdd_cum, crop, planted)
        kc = phenology.kc_for(gdd_cum, stage, crop, KC_BARE_SOIL)
        root = phenology.root_depth_for(gdd_cum, stage, crop, max_root, BARE_SOIL_DEPTH_M)
        if depletion is None:
            depletion = INITIAL_DEPLETION_FRACTION * water_balance.taw_mm(soil.awc_mm_per_m, root)
        ws = water_balance.step(
            depletion,
            soil.awc_mm_per_m,
            root,
            crop.depletion_fraction_p,
            day.precip,
            et0.et0_mm,
            kc,
            inputs.irrigation_level,
            soil.hydrologic_group,
        )
        depletion = ws.depletion_mm
        fraction = max(0.0, min(1.0, 1.0 - ws.depletion_mm / ws.taw_mm)) if ws.taw_mm > 0 else 0.0
        states.append(
            TwinState(
                date=day.date,
                crop_id=crop.crop_id,
                stage=stage,
                gdd_day=round(gdd_day, 3),
                gdd_cum=round(gdd_cum, 2),
                kc=round(kc, 4),
                root_depth_m=round(root, 3),
                taw_mm=round(ws.taw_mm, 2),
                raw_mm=round(ws.raw_mm, 2),
                root_zone_depletion_mm=round(ws.depletion_mm, 3),
                soil_water_fraction=round(fraction, 4),
                ks=round(ws.ks, 4),
                et0_mm=round(et0.et0_mm, 3),
                etc_mm=round(ws.etc_mm, 3),
                etc_adj_mm=round(ws.etc_adj_mm, 3),
                precip_mm=round(day.precip, 3),
                effective_precip_mm=round(ws.effective_precip_mm, 3),
                runoff_mm=round(ws.runoff_mm, 3),
                irrigation_mm=round(ws.irrigation_mm, 3),
                drainage_mm=round(ws.drainage_mm, 3),
                t_max=day.t_max,
                t_min=day.t_min,
                data_state=output_state,
            )
        )
    return states, _Carry(gdd_cum, planted, depletion)


def run_season(inputs: SeasonInputs) -> list[TwinState]:
    """Pure season run: same inputs always give the same states (days sorted and consecutive by contract)."""
    return _loop(inputs.days, inputs, _Carry(0.0, False, inputs.initial_depletion_mm), inputs.output_state)[0]


def fork(from_state: TwinState | None, inputs: SeasonInputs, scenario: TwinScenario) -> list[TwinState]:
    """Keep history up to `from_state` (inclusive) and re-run the future with perturbed weather.

    A neutral scenario (factor 1, delta 0) reproduces run_season exactly. The forked part is SIMULATED
    unless the inputs are SYNTHETIC, in which case SYNTHETIC propagates.
    """
    neutral = scenario.precip_factor == 1.0 and scenario.temp_delta_c == 0.0 and scenario.irrigation_level is None
    future_state = inputs.output_state if neutral or inputs.output_state is DataState.SYNTHETIC else DataState.SIMULATED
    # The scenario irrigation level only applies to the forked future; history keeps the zone's own level
    future_inputs = replace(inputs, irrigation_level=resolve_irrigation(inputs.irrigation_level, scenario))
    if from_state is None:
        days = perturb_series(inputs.days, scenario.precip_factor, scenario.temp_delta_c)
        return _loop(days, future_inputs, _Carry(0.0, False, inputs.initial_depletion_mm), future_state)[0]
    history = [d for d in inputs.days if d.date <= from_state.date]
    future = [d for d in inputs.days if d.date > from_state.date]
    past, carry = _loop(history, inputs, _Carry(0.0, False, inputs.initial_depletion_mm), inputs.output_state)
    if not future or not past:
        return past
    forked, _ = _loop(
        perturb_series(future, scenario.precip_factor, scenario.temp_delta_c), future_inputs, carry, future_state
    )
    return past + forked


# ─────────────────────────────────────────
# Section: Summary
# ─────────────────────────────────────────


def summarise(states: list[TwinState], crop: CropParams, planting_date: date) -> ZoneSummary:
    """Season aggregates over the crop period (planting .. harvest or end); product thresholds in config."""
    in_crop = [s for s in states if s.stage not in (PhenoStage.PRE_PLANTING, PhenoStage.HARVESTED)]
    scope = in_crop if in_crop else states
    ks_values = [s.ks for s in scope]
    mean_ks = sum(ks_values) / len(ks_values) if ks_values else 1.0
    swf = [s.soil_water_fraction for s in scope]
    first_of: dict[PhenoStage, date] = {}
    for s in states:
        first_of.setdefault(s.stage, s.date)
    stage_dates = StageDates(
        planting=planting_date if any(s.stage is not PhenoStage.PRE_PLANTING for s in states) else None,
        development=first_of.get(PhenoStage.DEVELOPMENT),
        mid_season=first_of.get(PhenoStage.MID_SEASON),
        late_season=first_of.get(PhenoStage.LATE_SEASON),
        maturity=first_of.get(PhenoStage.HARVESTED),
    )
    return ZoneSummary(
        mean_ks=round(mean_ks, 4),
        min_ks=round(min(ks_values), 4) if ks_values else 1.0,
        stress_days=sum(1 for k in ks_values if k < STRESS_DAY_KS),
        stress_class=stress_class_for(mean_ks),
        min_soil_water_fraction=round(min(swf), 4) if swf else 1.0,
        mean_soil_water_fraction=round(sum(swf) / len(swf), 4) if swf else 1.0,
        total_precip_mm=round(sum(s.precip_mm for s in states), 1),
        total_effective_precip_mm=round(sum(s.effective_precip_mm for s in states), 1),
        total_irrigation_mm=round(sum(s.irrigation_mm for s in states), 1),
        total_runoff_mm=round(sum(s.runoff_mm for s in states), 1),
        total_drainage_mm=round(sum(s.drainage_mm for s in states), 1),
        total_et0_mm=round(sum(s.et0_mm for s in states), 1),
        total_etc_adj_mm=round(sum(s.etc_adj_mm for s in states), 1),
        gdd_total=round(max((s.gdd_cum for s in states), default=0.0), 1),
        frost_days=sum(1 for s in scope if s.t_min < FROST_T_MIN_C),
        hot_days=sum(1 for s in scope if s.t_max > crop.t_max),
        cold_days=sum(1 for s in scope if s.t_min < crop.t_min),
        stage_dates=stage_dates,
        irrigation_events=sum(1 for s in states if s.irrigation_mm > 0),
    )


def season_outcome(
    states: list[TwinState], crop: CropParams, planting_date: date, summary: ZoneSummary
) -> SeasonOutcome:
    """Cycle completion inside the simulated window, from GDD stages, Ks and frost days only (no yield)."""
    planted = any(s.stage is not PhenoStage.PRE_PLANTING for s in states)
    maturity = next((s.date for s in states if s.stage is PhenoStage.HARVESTED), None)
    in_window = bool(states) and states[0].date <= planting_date <= states[-1].date
    # Twin outputs from observed weather are ESTIMATED; a cycle verdict is always a model result
    state = DataState.SYNTHETIC if states and states[-1].data_state is DataState.SYNTHETIC else DataState.SIMULATED
    return SeasonOutcome(
        status="COMPLETED" if maturity else ("NOT_MATURE" if planted else "NOT_PLANTED"),
        planted_in_window=in_window,
        reached_maturity=maturity is not None,
        maturity_date=maturity,
        gdd_accumulated=round(max((s.gdd_cum for s in states), default=0.0), 1),
        gdd_required=crop.gdd_stages.maturity,
        stress_days=summary.stress_days if planted else 0,
        stress_day_ks=STRESS_DAY_KS,
        frost_days=summary.frost_days if planted else 0,
        data_state=state,
    )


def default_planting(crop_id: str, year: int, mmdd_by_crop: dict[str, str]) -> date:
    mmdd = mmdd_by_crop.get(crop_id, "05-10")
    month, day = (int(p) for p in mmdd.split("-"))
    return date(year, month, day)


def date_range(start: date, end: date) -> list[date]:
    n = (end - start).days + 1
    return [start + timedelta(days=i) for i in range(max(n, 0))]
