"""Weather contract (canonical units: C, mm/day, %, MJ m-2 day-1, m/s at 2 m)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import Location, Provenance


class WeatherDay(BaseModel):
    date: date
    t_mean: float
    t_max: float
    t_min: float
    precip: float = Field(ge=0)
    rh_mean: float = Field(ge=0, le=100)
    solar_rad: float = Field(ge=0)
    wind_2m: float = Field(ge=0)
    # POWER root-zone / surface wetness indices (0-1), kept as context only
    gwet_root: float | None = None
    gwet_top: float | None = None
    qa_flags: list[str] = Field(default_factory=list)


class WeatherSeries(BaseModel):
    location: Location
    elevation_m: float
    days: list[WeatherDay]
    provenance: Provenance
    warnings: list[str] = Field(default_factory=list)
