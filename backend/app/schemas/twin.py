"""Digital twin contract: scenario, daily state, discrepancies, per-zone results."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import (
    DataState,
    IrrigationLevel,
    PhenoStage,
    Provenance,
    StressClass,
    StrictRequest,
    TwinLevel,
)

# ─────────────────────────────────────────
# Section: Scenario
# ─────────────────────────────────────────


class TwinScenario(StrictRequest):
    precip_factor: float = Field(default=1.0, ge=0.0, le=3.0)
    temp_delta_c: float = Field(default=0.0, ge=-8.0, le=8.0)
    irrigation_level: IrrigationLevel | None = Field(default=None, description="global override; None keeps zone level")
    preset: str | None = Field(default=None, description="named preset expanded server-side (product configuration)")


class MonteCarloRequest(StrictRequest):
    n: int = Field(default=0, ge=0, le=300)
    seed: int = 20261114


# ─────────────────────────────────────────
# Section: Daily state
# ─────────────────────────────────────────


class TwinState(BaseModel):
    date: date
    crop_id: str
    stage: PhenoStage
    gdd_day: float
    gdd_cum: float
    kc: float
    root_depth_m: float
    taw_mm: float
    raw_mm: float
    root_zone_depletion_mm: float
    soil_water_fraction: float = Field(ge=0, le=1, description="1 - Dr/TAW")
    ks: float = Field(ge=0, le=1)
    et0_mm: float
    etc_mm: float
    etc_adj_mm: float
    precip_mm: float
    effective_precip_mm: float
    runoff_mm: float
    irrigation_mm: float
    drainage_mm: float
    t_max: float
    t_min: float
    data_state: DataState


class Discrepancy(BaseModel):
    date: date
    variable: str
    observed: float
    simulated: float
    delta: float


class ComparisonMetrics(BaseModel):
    variable: str
    source_id: str
    n_points: int
    correlation: float | None
    mean_abs_delta: float | None
    observed_peak_date: date | None
    simulated_peak_date: date | None
    lag_days: int | None
    note: str
    data_state: DataState


class StageDates(BaseModel):
    planting: date | None = None
    development: date | None = None
    mid_season: date | None = None
    late_season: date | None = None
    maturity: date | None = None


class ZoneSummary(BaseModel):
    mean_ks: float
    min_ks: float
    stress_days: int
    stress_class: StressClass
    min_soil_water_fraction: float
    mean_soil_water_fraction: float
    total_precip_mm: float
    total_effective_precip_mm: float
    total_irrigation_mm: float
    total_runoff_mm: float
    total_drainage_mm: float
    total_et0_mm: float
    total_etc_adj_mm: float
    gdd_total: float
    frost_days: int
    hot_days: int
    cold_days: int
    stage_dates: StageDates
    irrigation_events: int


class SeasonOutcome(BaseModel):
    """Did the simulated crop complete its cycle inside the window? Model-derived; never a yield prediction."""

    # COMPLETED = GDD maturity reached; NOT_MATURE = planted but heat ran out; NOT_PLANTED = bare soil all window
    status: Literal["COMPLETED", "NOT_MATURE", "NOT_PLANTED"]
    planted_in_window: bool
    reached_maturity: bool
    maturity_date: date | None
    gdd_accumulated: float
    gdd_required: float
    # Crop-period days with Ks below stress_day_ks (product threshold, same as ZoneSummary.stress_days)
    stress_days: int
    stress_day_ks: float
    # Crop-period days with t_min below the frost threshold (same as ZoneSummary.frost_days)
    frost_days: int
    data_state: DataState
    note: str = "model outcome of the simulated crop cycle (GDD, Ks); not a yield prediction"


class MonteCarloSummary(BaseModel):
    n: int
    seed: int
    perturbed: dict[str, str]
    mean_ks_p10: float
    mean_ks_p50: float
    mean_ks_p90: float
    stress_days_p10: float
    stress_days_p50: float
    stress_days_p90: float
    min_soil_water_fraction_p10: float
    min_soil_water_fraction_p50: float
    min_soil_water_fraction_p90: float
    data_state: DataState = DataState.SIMULATED


class ZoneResult(BaseModel):
    zone_id: str
    name: str
    crop_id: str
    area_ha: float
    planting_date: date
    # Who said so: MEASURED (CDL), DECLARED (request / farm default) or ESTIMATED (calendar suggestion)
    crop_state: DataState = DataState.DECLARED
    planting_state: DataState = DataState.DECLARED
    irrigation_level: IrrigationLevel
    states: list[TwinState]
    summary: ZoneSummary
    ndvi: float | None
    ndvi_date: date | None
    ndvi_state: DataState
    ndvi_source: str | None
    discrepancies: list[Discrepancy] = Field(default_factory=list)
    comparison: list[ComparisonMetrics] = Field(default_factory=list)
    expected_canopy: list[dict[str, float | str]] = Field(default_factory=list)
    monte_carlo: MonteCarloSummary | None = None
    outcome: SeasonOutcome | None = None
    # Only for climate-projection runs: the same zone simulated with every climate model that answered
    projection_range: ProjectionRange | None = None
    data_state: DataState
    warnings: list[str] = Field(default_factory=list)


class ModelSeasonOutcome(BaseModel):
    model: str
    status: Literal["COMPLETED", "NOT_MATURE", "NOT_PLANTED"]
    stress_days: int
    season_precip_mm: float
    data_state: DataState = DataState.SIMULATED


class ProjectionRange(BaseModel):
    """Spread of the season outcome across climate models; each model is one possible future, not a forecast."""

    n_models: int
    matured_models: int
    stress_days_min: int
    stress_days_max: int
    season_precip_min_mm: float
    season_precip_max_mm: float
    by_model: list[ModelSeasonOutcome]
    data_state: DataState = DataState.SIMULATED
    note: str = "range across climate models (one possible future each); not a probability nor a forecast"


# ─────────────────────────────────────────
# Section: Climate source (optional, opt-in future climate)
# ─────────────────────────────────────────


class ProjectionRequest(StrictRequest):
    scenario: Literal["ssp126", "ssp245", "ssp370"]
    # None = the documented model set; 'ensemble' is rejected (its daily mean smooths away dry days)
    model: str | None = None


class ClimateProjectionInfo(BaseModel):
    """Exactly what fed a projection run, for the "Datos que usa esta simulación" block."""

    source: str
    scenario: str
    models_requested: list[str]
    models_used: list[str]
    models_failed: dict[str, str] = Field(default_factory=dict)
    animated_model: str
    animated_rule: str
    variables: list[str]
    conversions: list[str]
    filled_days: dict[str, list[str]] = Field(default_factory=dict)
    api_first_day: date
    api_last_day: date
    data_state: DataState = DataState.SIMULATED


# ─────────────────────────────────────────
# Section: Requests / responses
# ─────────────────────────────────────────


class TwinSimulateRequest(StrictRequest):
    farm_id: str = "story_pilot_farm"
    # None = suggested season: Apr-Oct 2024 for the pilot, latest complete hemisphere season for pt_ farms
    start: date | None = None
    end: date | None = None
    scenario: TwinScenario = Field(default_factory=TwinScenario)
    reference_year: int | None = Field(
        default=None, ge=1900, le=9997, description="Historical analogue year; simulated weather, not a forecast"
    )
    # None = behaviour unchanged (observed weather, or reference_year when given)
    climate_source: Literal["reference_year", "projection"] | None = None
    projection: ProjectionRequest | None = None
    fork_date: date | None = Field(default=None, description="observed weather up to this day, scenario after it")
    zone_ids: list[str] | None = None
    planting_dates: dict[str, date] | None = Field(
        default=None, description="DECLARED planting date keyed by zone_id or crop_id (zone_id wins)"
    )
    zone_crops: dict[str, str] | None = Field(
        default=None, description="DECLARED crop_id per zone_id; overrides CDL (pilot) or the default crop (pt_)"
    )
    crop_overrides: dict[str, str] | None = Field(
        default=None, description="DECLARED crop_id per zone_id (frontend contract); wins over zone_crops"
    )
    crop_override_state: Literal["DECLARED", "SIMULATED"] = "DECLARED"
    monte_carlo: MonteCarloRequest | None = None
    include_states: bool = True
    include_comparison: bool = True


class FarmSummary(BaseModel):
    area_ha: float
    mean_ks_area_weighted: float
    stress_class: StressClass
    mean_soil_water_fraction: float
    total_precip_mm: float
    total_irrigation_mm: float
    note: str


class TwinSimulateResponse(BaseModel):
    methodology: str = "twin_v1"
    catalog_version: str
    data_mode: str
    twin_level: TwinLevel
    farm_id: str
    start: date
    end: date
    scenario: TwinScenario
    scenario_expanded: dict[str, float | str | None]
    zones: list[ZoneResult]
    farm_summary: FarmSummary
    warnings: list[str] = Field(default_factory=list)
    provenance: dict[str, Provenance]
    climate_projection: ClimateProjectionInfo | None = None
    # When the run was computed (UTC); start/end are the simulated window, not this
    computed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ZoneStateSnapshot(BaseModel):
    zone_id: str
    name: str
    crop_id: str
    area_ha: float
    state: TwinState | None
    stress_class: StressClass
    ndvi: float | None
    ndvi_date: date | None
    ndvi_state: DataState


class TwinStateResponse(BaseModel):
    methodology: str = "twin_v1"
    farm_id: str
    date: date
    data_mode: str
    twin_level: TwinLevel
    zones: list[ZoneStateSnapshot]
    warnings: list[str] = Field(default_factory=list)
    provenance: dict[str, Provenance]
