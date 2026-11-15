"""Observation contract: NDVI (MODIS / Sentinel-2) and SMAP soil moisture series."""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field

from app.schemas.common import DataState, Provenance


class ObservationVariable(str, Enum):
    NDVI = "ndvi"
    SOIL_MOISTURE = "soil_moisture"


class ObservationPoint(BaseModel):
    date: date
    variable: ObservationVariable
    value: float
    zone_id: str | None = None
    n_pixels: int | None = None
    qa_flag: str | None = None


class ObservationSeries(BaseModel):
    variable: ObservationVariable
    source_id: str
    resolution_m: float
    points: list[ObservationPoint]
    provenance: Provenance
    warnings: list[str] = Field(default_factory=list)


class NdviOverlay(BaseModel):
    farm_id: str
    date: date
    source: str
    resolution_m: float
    bounds: dict[str, float]
    width_px: int
    height_px: int
    png_base64: str
    data_state: DataState
    legend_stops: list[dict[str, float | str]]
    warnings: list[str] = Field(default_factory=list)
