"""Imagery, terrain and data-catalog contracts (PROPOSAL, consumed by the frontend map and 3D scene)."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import DataState, Provenance


class BasemapInfo(BaseModel):
    width: int
    height: int
    source: str
    acquired: date | None = None
    resolution_m: float


class ImageryMeta(BaseModel):
    farm_id: str
    # (west, south, east, north); basemap, NDVI overlays and heightmap share exactly these bounds
    bounds_wgs84: list[float] = Field(min_length=4, max_length=4)
    crs: str
    basemap: BasemapInfo
    ndvi_dates: list[date]
    sources: list[Provenance]
    data_state: DataState
    warnings: list[str] = Field(default_factory=list)


class NdviSceneInfo(BaseModel):
    date: date
    valid_fraction: float = Field(ge=0, le=1, description="Share of farm pixels that passed the SCL cloud mask")
    cloud_free: bool
    farm_ndvi_mean: float | None
    # True when the coloured PNG ships in derived/ (works with no network)
    prerendered: bool


class NdviDates(BaseModel):
    farm_id: str
    dates: list[NdviSceneInfo]
    cloud_free_threshold: float
    source: str
    resolution_m: float
    data_state: DataState
    provenance: Provenance
    warnings: list[str] = Field(default_factory=list)


class Heightmap(BaseModel):
    farm_id: str
    bounds_wgs84: list[float]
    width: int
    height: int
    min_m: float
    max_m: float
    resolution_m: float
    row_order: str
    data: list[float]
    data_state: DataState
    provenance: Provenance
    note: str
    warnings: list[str] = Field(default_factory=list)


class CatalogSource(BaseModel):
    source_id: str
    files: int
    size_mb: float


class DataCatalog(BaseModel):
    # Where requests are being served from right now ("s3" or "local"); the bucket name is never exposed
    mode: str
    requested_source: str
    s3_configured: bool
    s3_accessible: bool
    s3_detail: str | None = None
    local_available: bool
    sources: list[CatalogSource]
    total_files: int
    total_size_mb: float
    derived_size_mb: float
    cache_size_mb: float
    cache_max_mb: int
    transfer_since_start: dict[str, int]
    data_state: DataState = DataState.MEASURED
    warnings: list[str] = Field(default_factory=list)
