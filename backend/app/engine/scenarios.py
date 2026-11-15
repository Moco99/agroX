"""Scenario expansion and weather perturbation (What If, models 12-13)."""

from __future__ import annotations

from app.engine.config import SCENARIO_PRESETS
from app.schemas.common import IrrigationLevel
from app.schemas.twin import TwinScenario
from app.schemas.weather import WeatherDay


def expand_scenario(scenario: TwinScenario) -> TwinScenario:
    """A named preset overrides the numeric factors; unknown presets raise (router maps to 422)."""
    if scenario.preset is None:
        return scenario
    preset = SCENARIO_PRESETS.get(scenario.preset)
    if preset is None:
        raise ValueError(f"unknown scenario preset '{scenario.preset}'")
    return TwinScenario(
        precip_factor=preset.precip_factor,
        temp_delta_c=preset.temp_delta_c,
        irrigation_level=scenario.irrigation_level,
        preset=scenario.preset,
    )


def perturb_day(day: WeatherDay, precip_factor: float, temp_delta_c: float) -> WeatherDay:
    """Scale rain and shift temperatures; RH, wind and radiation are kept (documented simplification)."""
    if precip_factor == 1.0 and temp_delta_c == 0.0:
        return day
    return day.model_copy(
        update={
            "precip": max(0.0, day.precip * precip_factor),
            "t_mean": day.t_mean + temp_delta_c,
            "t_max": day.t_max + temp_delta_c,
            "t_min": day.t_min + temp_delta_c,
        }
    )


def perturb_series(days: list[WeatherDay], precip_factor: float, temp_delta_c: float) -> list[WeatherDay]:
    return [perturb_day(d, precip_factor, temp_delta_c) for d in days]


def resolve_irrigation(zone_level: IrrigationLevel, scenario: TwinScenario) -> IrrigationLevel:
    return scenario.irrigation_level if scenario.irrigation_level is not None else zone_level
