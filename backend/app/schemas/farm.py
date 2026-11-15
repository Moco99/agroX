"""Farm / zone contract (PROPOSAL accepted in this branch): a farm is a list of management zones."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import DataState, IrrigationLevel, Location, Provenance
from app.schemas.soil import SoilProfile


class PolygonGeometry(BaseModel):
    type: str = "Polygon"
    coordinates: list[list[list[float]]]


class CdlYear(BaseModel):
    year: int
    cdl_code: int
    crop_id: str
    purity: float


class TerrainInfo(BaseModel):
    elevation_mean_m: float | None
    slope_mean_pct: float | None
    slope_max_pct: float | None
    # Product classification of slope (not USLE): low < 2 %, moderate 2-5 %, high > 5 %
    erosion_index: str
    data_state: DataState
    warnings: list[str] = Field(default_factory=list)


class FarmZone(BaseModel):
    zone_id: str
    name: str
    crop_id: str
    crop_purity: float | None = None
    area_ha: float
    geometry: PolygonGeometry
    centroid: Location
    soil: SoilProfile
    terrain: TerrainInfo
    cdl_history: list[CdlYear] = Field(default_factory=list)
    irrigation_level: IrrigationLevel = IrrigationLevel.NONE
    data_state: DataState = DataState.DECLARED


class Farm(BaseModel):
    farm_id: str
    name: str
    area_ha: float
    centroid: Location
    geometry: PolygonGeometry
    zones: list[FarmZone]
    provenance: dict[str, Provenance]
    warnings: list[str] = Field(default_factory=list)


class FarmAnalyzeRequest(BaseModel):
    farm_id: str = "story_pilot_farm"


class FarmAnalyzeResponse(BaseModel):
    farm: Farm
    data_mode: str
    catalog_version: str
    latest_ndvi: dict[str, float | None]
    latest_ndvi_date: str | None
    latest_ndvi_source: str | None
    warnings: list[str] = Field(default_factory=list)
