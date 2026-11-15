"""Farm / zone contract (PROPOSAL accepted in this branch): a farm is a list of management zones."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import DataState, IrrigationLevel, Location, Provenance, StrictRequest
from app.schemas.load import FarmLoadStatus
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


class FarmAnalyzeRequest(StrictRequest):
    farm_id: str = "story_pilot_farm"


class LatLon(StrictRequest):
    lat: float
    lon: float


class PolygonFarmRequest(StrictRequest):
    """User-drawn farm: one zone per polygon; vertices in order, ring closure optional."""

    # Coarse bounds here; vertex counts, self-intersection, areas and span are checked in the parcel module
    polygons: list[list[LatLon]] = Field(min_length=1, max_length=12)


class PolygonFarmResponse(BaseModel):
    farm_id: str
    zone_count: int
    # Approximate geodesic area (local equirectangular projection), per zone and total
    zone_area_ha: list[float]
    area_ha: float
    data_state: DataState = DataState.DECLARED


class CropOption(BaseModel):
    crop_id: str
    name_es: str
    crop_type: str
    verified: bool


class SeasonWindow(BaseModel):
    start: date
    end: date


class DeclaredInputs(BaseModel):
    """What the user must declare for the twin, with product-calendar suggestions (never measured data)."""

    crop_options: list[CropOption]
    catalog_version: str
    default_crop_by_zone: dict[str, str]
    # MEASURED when the crop comes from CDL (pilot), DECLARED when it is only the default of a pt_ farm
    crop_state: DataState
    hemisphere: Literal["north", "south"]
    tropical: bool
    suggested_season: SeasonWindow
    suggested_planting_dates: dict[str, date]
    suggestion_state: DataState = DataState.ESTIMATED
    note: str
    unsupported_crop_note: str


class LandCover(BaseModel):
    """Is the selected point cropland? (ESA WorldCover 2021 + Impact Observatory LULC, 10 m)."""

    status: Literal["ready", "pending", "failed", "not_applicable"]
    is_cropland: bool | None = None
    worldcover_2021: str | None = None
    by_year: dict[str, str] = Field(default_factory=dict)
    source: str = "ESA WorldCover 2021 + Impact Observatory LULC annual (Planetary Computer)"
    data_state: DataState = DataState.ESTIMATED
    warning: str | None = None


class FarmAnalyzeResponse(BaseModel):
    farm: Farm
    data_mode: str
    catalog_version: str
    latest_ndvi: dict[str, float | None]
    latest_ndvi_date: str | None
    latest_ndvi_source: str | None
    declared_inputs: DeclaredInputs | None = None
    land_cover: LandCover | None = None
    # Staged loading of slow live sources (soil, NDVI, imagery); None for farms served from derived/ only
    load_status: FarmLoadStatus | None = None
    warnings: list[str] = Field(default_factory=list)
