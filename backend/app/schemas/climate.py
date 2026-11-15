"""Climate endpoint contract: series + indicators (Earth Scanner)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import Metric, Provenance
from app.schemas.weather import WeatherSeries


class ClimateIndicators(BaseModel):
    start: date
    end: date
    days: int
    precip_total: Metric
    t_mean: Metric
    t_max_mean: Metric
    t_min_mean: Metric
    solar_mean: Metric
    et0_total: Metric
    et0_method: str
    gdd_total: Metric
    gdd_base_c: float
    frost_days: Metric
    hot_days: Metric
    hot_threshold_c: float
    cold_days: Metric
    cold_threshold_c: float
    precip_anomaly_pct: Metric
    spi: Metric


class ClimateResponse(BaseModel):
    methodology: str = "climate_v1"
    data_mode: str
    series: WeatherSeries
    indicators: ClimateIndicators
    warnings: list[str] = Field(default_factory=list)
    provenance: Provenance
