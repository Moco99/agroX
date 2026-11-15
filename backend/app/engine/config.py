"""Product configuration of the twin (NOT science): irrigation rules, runoff, presets, thresholds.

Every number here is a documented assumption chosen to make the simulation
runnable and explainable in the demo. They are exposed through the API so the UI
can show them, and they are listed in docs/00-overview/decisions.md.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.common import IrrigationLevel, StressClass

# ─────────────────────────────────────────
# Section: Irrigation (O-15)
# ─────────────────────────────────────────


@dataclass(frozen=True)
class IrrigationRule:
    """Apply `depth_mm` whenever depletion exceeds `trigger_fraction_of_raw` x RAW (one event per day max)."""

    depth_mm: float
    trigger_fraction_of_raw: float


IRRIGATION_RULES: dict[IrrigationLevel, IrrigationRule] = {
    IrrigationLevel.NONE: IrrigationRule(depth_mm=0.0, trigger_fraction_of_raw=10.0),
    IrrigationLevel.LOW: IrrigationRule(depth_mm=15.0, trigger_fraction_of_raw=1.0),
    IrrigationLevel.MEDIUM: IrrigationRule(depth_mm=25.0, trigger_fraction_of_raw=0.8),
    IrrigationLevel.HIGH: IrrigationRule(depth_mm=35.0, trigger_fraction_of_raw=0.6),
}

# ─────────────────────────────────────────
# Section: Runoff (model-specs §4: simple documented rule)
# ─────────────────────────────────────────

# Fraction of daily rain above RUNOFF_THRESHOLD_MM that leaves as runoff, by hydrologic soil group
RUNOFF_THRESHOLD_MM = 5.0
RUNOFF_COEFF_BY_HYDGRP: dict[str, float] = {"A": 0.05, "B": 0.10, "C": 0.15, "D": 0.20}
RUNOFF_COEFF_DEFAULT = 0.12

# ─────────────────────────────────────────
# Section: Bare soil and initial state
# ─────────────────────────────────────────

# FAO-56 suggests Kc of bare, occasionally wetted soil around 0.15-0.30: we use the upper bound (assumption)
KC_BARE_SOIL = 0.30
# Evaporation layer depth used before planting / after harvest (FAO-56 Ze ~0.10-0.15 m; assumption)
BARE_SOIL_DEPTH_M = 0.15
# Initial depletion as fraction of TAW at simulation start (profile near field capacity after winter)
INITIAL_DEPLETION_FRACTION = 0.10

# ─────────────────────────────────────────
# Section: Stress classes (O-16) and thresholds
# ─────────────────────────────────────────

# Ks is 1 without stress; classes below are product thresholds on the season mean Ks
STRESS_CLASS_THRESHOLDS: list[tuple[float, StressClass]] = [
    (0.95, StressClass.NONE),
    (0.85, StressClass.LOW),
    (0.70, StressClass.MEDIUM),
    (0.0, StressClass.HIGH),
]
# A day counts as "stress day" when Ks drops below this value
STRESS_DAY_KS = 0.8
FROST_T_MIN_C = 0.0


def stress_class_for(mean_ks: float) -> StressClass:
    for threshold, cls in STRESS_CLASS_THRESHOLDS:
        if mean_ks >= threshold:
            return cls
    return StressClass.HIGH


# ─────────────────────────────────────────
# Section: Scenario presets (O-14)
# ─────────────────────────────────────────


@dataclass(frozen=True)
class ScenarioPreset:
    precip_factor: float
    temp_delta_c: float
    description_en: str


SCENARIO_PRESETS: dict[str, ScenarioPreset] = {
    "baseline": ScenarioPreset(1.0, 0.0, "Observed 2024 weather, no perturbation"),
    "moderate_drought": ScenarioPreset(0.6, 1.5, "40 % less rain and +1.5 C (product configuration, not a forecast)"),
    "severe_drought": ScenarioPreset(0.4, 3.0, "60 % less rain and +3 C (product configuration, not a forecast)"),
    "wet_cool": ScenarioPreset(1.3, -1.0, "30 % more rain and -1 C (product configuration, not a forecast)"),
    "heat_wave": ScenarioPreset(0.85, 3.0, "15 % less rain and +3 C (product configuration, not a forecast)"),
}

# ─────────────────────────────────────────
# Section: Default planting dates for the pilot (DECLARED assumption)
# ─────────────────────────────────────────

DEFAULT_PLANTING_MMDD: dict[str, str] = {"corn": "05-05", "soybean": "05-15", "cereal_rye": "10-01"}

# Point farms (ADR-026): the same pilot calendar, shifted 6 months south of the equator. A product default
# so the twin can run before the user declares dates, NOT an agronomic calendar of the place (ESTIMATED).
SOUTH_SHIFT_MONTHS = 6
# Season windows used when a request gives no period (north: Apr-Oct; south: Oct-Apr, crossing new year)
NORTH_SEASON_MMDD = ("04-01", "10-31")
SOUTH_SEASON_MMDD = ("10-01", "04-30")
# Between the tropics planting follows the rainy season, which a hemisphere rule cannot capture
TROPICS_LAT = 23.44
# Days after a season ends before it counts as complete (POWER publishes with a few days of lag)
SEASON_COMPLETE_LAG_DAYS = 5
# Longest period one twin run accepts: one season, which may cross 1 January in the south
MAX_SEASON_DAYS = 366

# ─────────────────────────────────────────
# Section: Erosion index from slope (product classification)
# ─────────────────────────────────────────


def erosion_index_for(slope_pct: float | None) -> str:
    if slope_pct is None:
        return "unknown"
    if slope_pct < 2.0:
        return "low"
    if slope_pct < 5.0:
        return "moderate"
    return "high"
