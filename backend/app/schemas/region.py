"""Regional summary contract for the "Analisis de region" panel (PROPOSAL)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import DataState, Provenance


class Period(BaseModel):
    start: date
    end: date
    days: int


class RegionMetric(BaseModel):
    value: float | None
    unit: str
    # Change versus the immediately preceding period of equal length (not versus a long-term normal)
    previous: float | None
    delta: float | None
    delta_pct: float | None
    data_state: DataState
    source: str


class NdviPoint(BaseModel):
    date: date
    value: float


class CropSuitability(BaseModel):
    crop: str
    index: int | None = Field(description="GAEZ suitability index 0-10000 (not a probability)")
    index_pct: float | None


class Suitability(BaseModel):
    label: str
    interpretation: str
    source: str
    period: str
    resolution: str
    data_state: DataState
    crops: list[CropSuitability]


class RegionSummary(BaseModel):
    region_id: str
    name: str
    bbox_wgs84: list[float]
    period: Period
    previous_period: Period
    ndvi: RegionMetric
    precipitation: RegionMetric
    temperature: RegionMetric
    radiation: RegionMetric
    ndvi_series: list[NdviPoint]
    suitability: Suitability | None
    data_state: DataState
    provenance: list[Provenance]
    warnings: list[str] = Field(default_factory=list)
