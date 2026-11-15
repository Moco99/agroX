"""HTTP routers: parse/validate, call one service, return the contract model. No business logic here."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import providers_dep
from app.config import get_settings
from app.providers.factory import Providers
from app.providers.live.parcel import MAX_LAT, MIN_LAT
from app.providers.real import manifest_entry
from app.schemas.climate import ClimateResponse
from app.schemas.crops import CropCatalog
from app.schemas.farm import FarmAnalyzeRequest, FarmAnalyzeResponse, PolygonFarmRequest, PolygonFarmResponse
from app.schemas.load import FarmLoadStatus
from app.schemas.observations import NdviOverlay, ObservationSeries
from app.schemas.rotations import RotationRecommendRequest
from app.schemas.twin import TwinSimulateRequest, TwinSimulateResponse, TwinStateResponse
from app.services import climate_service, farm_load_service, farm_service, twin_service

router = APIRouter(prefix="/api")
ProvidersDep = Annotated[Providers, Depends(providers_dep)]

# ─────────────────────────────────────────
# Section: Health and catalog
# ─────────────────────────────────────────


@router.get("/health")
def health(p: ProvidersDep) -> dict[str, object]:
    settings = get_settings()
    cov_start, cov_end = p.weather.coverage()
    from_derived = p.mode in ("real", "live")
    built = manifest_entry(settings.derived_dir, "weather_power_daily").get("built_at") if from_derived else None
    return {
        "status": "ok",
        "version": settings.version,
        "data_mode": p.mode,
        "data_state": "SYNTHETIC" if p.mode == "synthetic" else "MEASURED",
        "requested_mode": settings.data_mode,
        # The frontend reads this before offering "open any point": pt_<lat>_<lon> farms need live mode
        "any_parcel_supported": p.any_parcel_supported,
        "point_farm": {
            "id_pattern": "pt_<lat>_<lon>",
            "lat_range": [MIN_LAT, MAX_LAT],
            "lon_range": [-180.0, 180.0],
            "requires_mode": "live",
            "polygon_id_pattern": "poly_<lat>_<lon>_<12 hex> (POST /api/farms/polygon)",
            "hint": None if p.any_parcel_supported else "restart the backend with AGROX_DATA_MODE=live (make dev-live)",
        },
        "weather_coverage": {"start": cov_start.isoformat(), "end": cov_end.isoformat()},
        "derived_built_at": built,
        "farms": p.farm.farm_ids(),
        "warnings": list(p.warnings),
    }


@router.get("/crops", response_model=CropCatalog)
def crops(p: ProvidersDep) -> CropCatalog:
    return p.catalog.get_catalog()


@router.get("/climate", response_model=ClimateResponse)
def climate(
    p: ProvidersDep,
    start: date = date(2024, 4, 1),
    end: date = date(2024, 10, 31),
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> ClimateResponse:
    return climate_service.get_climate(p, start, end, lat, lon)


# ─────────────────────────────────────────
# Section: Farms and observations
# ─────────────────────────────────────────


@router.get("/farms")
def farms(p: ProvidersDep) -> dict[str, object]:
    return {"data_mode": p.mode, "farm_ids": p.farm.farm_ids()}


@router.post("/farms/analyze", response_model=FarmAnalyzeResponse)
def analyze(p: ProvidersDep, body: FarmAnalyzeRequest) -> FarmAnalyzeResponse:
    return farm_service.analyze_farm(p, body.farm_id)


@router.post("/farms/polygon", response_model=PolygonFarmResponse, status_code=201)
def register_polygon_farm(body: PolygonFarmRequest) -> PolygonFarmResponse:
    return farm_service.register_polygon(body)


@router.get("/farms/{farm_id}", response_model=FarmAnalyzeResponse)
def farm(p: ProvidersDep, farm_id: str) -> FarmAnalyzeResponse:
    return farm_service.analyze_farm(p, farm_id)


@router.post("/farms/{farm_id}/prepare", response_model=FarmLoadStatus, status_code=202)
def prepare_farm(p: ProvidersDep, farm_id: str) -> FarmLoadStatus:
    return farm_load_service.prepare(p, farm_id)


@router.get("/farms/{farm_id}/status", response_model=FarmLoadStatus)
def farm_status(p: ProvidersDep, farm_id: str) -> FarmLoadStatus:
    return farm_load_service.status(p, farm_id)


@router.get("/observations/ndvi", response_model=ObservationSeries)
def ndvi(
    p: ProvidersDep,
    farm_id: str = "story_pilot_farm",
    source: Literal["modis_ndvi", "sentinel2"] = "modis_ndvi",
    start: date | None = None,
    end: date | None = None,
) -> ObservationSeries:
    return farm_service.ndvi_series(p, farm_id, source, start, end)


@router.get("/observations/ndvi-overlay", response_model=NdviOverlay)
def ndvi_overlay(p: ProvidersDep, farm_id: str = "story_pilot_farm") -> NdviOverlay:
    return farm_service.ndvi_overlay(p, farm_id)


@router.get("/observations/soil-moisture", response_model=ObservationSeries)
def soil_moisture(
    p: ProvidersDep, farm_id: str = "story_pilot_farm", start: date | None = None, end: date | None = None
) -> ObservationSeries:
    return farm_service.soil_moisture(p, farm_id, start, end)


# ─────────────────────────────────────────
# Section: Twin
# ─────────────────────────────────────────


@router.get("/twin/config")
def twin_config() -> dict[str, object]:
    return twin_service.twin_config()


@router.get("/twin/state", response_model=TwinStateResponse)
def twin_state(
    p: ProvidersDep, farm_id: str = "story_pilot_farm", day: Annotated[date, Query(alias="date")] = date(2024, 7, 15)
) -> TwinStateResponse:
    return twin_service.state_on(p, farm_id, day)


@router.post("/twin/simulate", response_model=TwinSimulateResponse)
def twin_simulate(p: ProvidersDep, body: TwinSimulateRequest) -> TwinSimulateResponse:
    return twin_service.simulate(p, body)


@router.get("/twin/observed-vs-simulated", response_model=TwinSimulateResponse)
def observed_vs_simulated(
    p: ProvidersDep,
    farm_id: str = "story_pilot_farm",
    # NASA POWER daily history starts in 1981; an unbounded year made date() raise a 500
    year: Annotated[int, Query(ge=1981, le=2100)] = 2024,
) -> TwinSimulateResponse:
    # Same run as the baseline simulation, without daily states: metrics + discrepancies only
    req = TwinSimulateRequest(
        farm_id=farm_id, start=date(year, 4, 1), end=date(year, 10, 31), include_states=True, include_comparison=True
    )
    return twin_service.simulate(p, req)


# ─────────────────────────────────────────
# Section: EcoCrop-RF Rotation Engine
# ─────────────────────────────────────────


@router.get("/ecocrop/search")
def search_ecocrop(
    q: Annotated[str, Query(min_length=1, max_length=100)], limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[dict[str, object]]:
    from app.services import rotation_service

    return rotation_service.search(q, limit)


@router.post("/rotations/recommend")
def recommend_rotations(p: ProvidersDep, body: RotationRecommendRequest) -> dict[str, object]:
    from app.services import rotation_service

    return rotation_service.recommend(p, body)
