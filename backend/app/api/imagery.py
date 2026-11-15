"""Bounded imagery and terrain endpoints."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.routes import ProvidersDep
from app.schemas.imagery import DataCatalog, Heightmap, ImageryMeta, NdviDates
from app.schemas.region import RegionSummary
from app.services import imagery_service, region_service

router = APIRouter(prefix="/api")
Size = Annotated[int, Query(ge=64, le=2048)]


@router.get("/imagery/meta", response_model=ImageryMeta)
def meta(farm_id: str = "story_pilot_farm") -> ImageryMeta:
    return imagery_service.meta(farm_id)


@router.get("/imagery/ndvi/dates", response_model=NdviDates)
def dates(farm_id: str = "story_pilot_farm") -> NdviDates:
    return imagery_service.dates(farm_id)


@router.get("/terrain/heightmap", response_model=Heightmap)
def heightmap(farm_id: str = "story_pilot_farm") -> Heightmap:
    return imagery_service.heightmap(farm_id)


@router.get("/imagery/basemap")
def basemap(farm_id: str = "story_pilot_farm", size: Size = 2048) -> Response:
    return Response(imagery_service.image(farm_id, size), media_type="image/jpeg")


@router.get("/imagery/ndvi")
def ndvi(date: date, farm_id: str = "story_pilot_farm", size: Size = 1024) -> Response:
    return Response(imagery_service.image(farm_id, size, date), media_type="image/png")


@router.get("/region/summary", response_model=RegionSummary)
def region_summary(
    p: ProvidersDep, period_start: date = date(2024, 4, 1), period_end: date = date(2024, 10, 31)
) -> RegionSummary:
    return region_service.summary(p, period_start, period_end)


@router.get("/data/catalog", response_model=DataCatalog)
def catalog() -> DataCatalog:
    return imagery_service.catalog()
