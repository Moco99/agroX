"""Farm / observation use cases: load the farm with its zones, NDVI series, SMAP and the S2 overlay."""

from __future__ import annotations

from datetime import date

from app.engine.calendar import hemisphere, is_tropical, suggested_planting, suggested_season
from app.providers.factory import Providers
from app.providers.live.parcel import point_farm, polygon_zone_rings, register_polygon_farm, ring_area_ha
from app.providers.ports import DataNotFoundError
from app.schemas.common import DataState
from app.schemas.crops import CropCatalog
from app.schemas.farm import (
    CropOption,
    DeclaredInputs,
    Farm,
    FarmAnalyzeResponse,
    LandCover,
    PolygonFarmRequest,
    PolygonFarmResponse,
    SeasonWindow,
)
from app.schemas.observations import NdviOverlay, ObservationPoint, ObservationSeries
from app.services import farm_load_service, imagery_service
from app.services.errors import InvalidRequestError

# The point-farm NDVI series takes ~60 s the first time: responses never wait for it (ADR-024)
NDVI_LOADING_WARNING = "Sentinel-2 NDVI series still loading in the background: poll /api/farms/{farm_id}/status"


def register_polygon(body: PolygonFarmRequest) -> PolygonFarmResponse:
    """Register a drawn farm and return its id; the farm then opens through GET /api/farms/{id} like pt_ ids."""
    farm_id = register_polygon_farm([[(v.lat, v.lon) for v in poly] for poly in body.polygons])
    areas = [round(ring_area_ha(r), 2) for r in polygon_zone_rings(farm_id).values()]
    return PolygonFarmResponse(farm_id=farm_id, zone_count=len(areas), zone_area_ha=areas, area_ha=round(sum(areas), 2))


def ndvi_ready(p: Providers, farm_id: str) -> bool:
    """False while a point farm's live NDVI series is not built yet (pilot farms are never held back)."""
    if p.live_observations is None or point_farm(farm_id) is None:
        return True
    return p.live_observations.series_ready(farm_id)


def latest_ndvi_by_zone(
    p: Providers, farm_id: str, on_or_before: date | None = None
) -> tuple[dict[str, ObservationPoint], ObservationSeries | None]:
    """Latest NDVI per zone, preferring the finer source (Sentinel-2) when it has a point in range."""
    best: dict[str, ObservationPoint] = {}
    chosen: ObservationSeries | None = None
    for source_id in ("sentinel2", "modis_ndvi"):
        if source_id not in p.observations.ndvi_sources():
            continue
        if source_id == "sentinel2" and not ndvi_ready(p, farm_id):
            continue
        try:
            series = p.observations.ndvi_series(farm_id, source_id)
        except DataNotFoundError:
            continue
        candidates: dict[str, ObservationPoint] = {}
        for pt in series.points:
            if pt.zone_id is None or (on_or_before is not None and pt.date > on_or_before):
                continue
            if pt.zone_id not in candidates or pt.date > candidates[pt.zone_id].date:
                candidates[pt.zone_id] = pt
        if not candidates:
            continue
        # A Sentinel-2 value older than the latest MODIS composite would hide fresher information
        if best and max(c.date for c in candidates.values()) <= max(b.date for b in best.values()):
            continue
        best, chosen = candidates, series
    return best, chosen


def analyze_farm(p: Providers, farm_id: str) -> FarmAnalyzeResponse:
    pt = farm_load_service.ensure_supported(p, farm_id)
    farm = p.farm.get_farm(farm_id)
    catalog = p.catalog.get_catalog()
    # Start the slow sources (NDVI, imagery, land cover) after the farm itself, so this request is the one
    # that waits the short first-load soil window and the background jobs never race it
    load = farm_load_service.prepare(p, farm_id) if p.mode == "live" else None
    latest, series = latest_ndvi_by_zone(p, farm_id)
    warnings = list(p.warnings) + list(farm.warnings)
    for z in farm.zones:
        warnings.extend(f"{z.zone_id}: {w}" for w in z.soil.warnings)
    if not ndvi_ready(p, farm_id):
        warnings.append(NDVI_LOADING_WARNING.format(farm_id=farm_id))
    if any(not c.verified for c in catalog.crops):
        warnings.append("crop parameters are provisional (verified=false): literature values to verify")
    land = land_cover(p, pt)
    if land.warning:
        warnings.append(land.warning)
    dates = [pt_.date for pt_ in latest.values()]
    return FarmAnalyzeResponse(
        farm=farm,
        data_mode=p.mode,
        catalog_version=catalog.catalog_version,
        latest_ndvi={z.zone_id: (latest[z.zone_id].value if z.zone_id in latest else None) for z in farm.zones},
        latest_ndvi_date=max(dates).isoformat() if dates else None,
        latest_ndvi_source=series.source_id if series else None,
        declared_inputs=declared_inputs(farm, catalog, pt is not None, date.today()),
        land_cover=land,
        load_status=load,
        warnings=list(dict.fromkeys(warnings)),
    )


# ─────────────────────────────────────────
# Section: Declared inputs and land cover
# ─────────────────────────────────────────


def declared_inputs(farm: Farm, catalog: CropCatalog, is_point: bool, today: date) -> DeclaredInputs:
    """Crop options and calendar suggestions the UI needs before running the twin (never measured values)."""
    lat = farm.centroid.lat
    if is_point:
        start, end = suggested_season(lat, today)
        plantings = {c.crop_id: suggested_planting(c.crop_id, lat, start) for c in catalog.crops}
    else:
        # The pilot keeps its documented 2024 season and US Midwest dates (ADR-018)
        start, end = date(2024, 4, 1), date(2024, 10, 31)
        plantings = {c.crop_id: suggested_planting(c.crop_id, lat, start) for c in catalog.crops}
    crops = ", ".join(c.crop_id for c in catalog.crops)
    return DeclaredInputs(
        crop_options=[
            CropOption(crop_id=c.crop_id, name_es=c.name_es, crop_type=c.crop_type.value, verified=c.verified)
            for c in catalog.crops
        ],
        catalog_version=catalog.catalog_version,
        default_crop_by_zone={z.zone_id: z.crop_id for z in farm.zones},
        crop_state=DataState.DECLARED if is_point else DataState.MEASURED,
        hemisphere=hemisphere(lat),
        tropical=is_tropical(lat),
        suggested_season=SeasonWindow(start=start, end=end),
        suggested_planting_dates=plantings,
        note=(
            "suggestion, verify: US Midwest pilot calendar, shifted 6 months in the southern hemisphere "
            "(product configuration, not a local agronomic calendar nor a measurement)"
            + (
                "; between the tropics planting follows the rainy season: declare the real date"
                if is_tropical(lat)
                else ""
            )
        ),
        unsupported_crop_note=(
            f"only crops in {catalog.catalog_version} can be simulated ({crops}); "
            "any other crop_id is rejected with 422"
        ),
    )


def land_cover(p: Providers, pt: tuple[float, float] | None) -> LandCover:
    """Cached land-cover answer for a point farm; never waits (the load job fetches it)."""
    if pt is None or p.land_cover is None:
        return LandCover(status="not_applicable")
    found = p.land_cover.lookup(*pt)
    if found.status == "running":
        return LandCover(status="pending")
    if found.status == "failed" or not found.value:
        return LandCover(status="failed", warning=f"land cover unavailable ({found.error}); point not checked")
    value = found.value
    by_year = value.get("por_anio")
    is_crop = value.get("es_cultivo")
    cover = value.get("worldcover_2021")
    years = {str(k): str(v) for k, v in by_year.items()} if isinstance(by_year, dict) else {}
    crop_flag = bool(is_crop) if isinstance(is_crop, bool) else None
    warning = None
    if crop_flag is False:
        warning = (
            f"this point does not look like cropland (WorldCover 2021: {cover}; LULC by year: "
            f"{', '.join(f'{y} {c}' for y, c in sorted(years.items())) or 'n/a'}): the twin still runs, "
            "but check the location"
        )
    return LandCover(
        status="ready",
        is_cropland=crop_flag,
        worldcover_2021=str(cover) if cover is not None else None,
        by_year=years,
        warning=warning,
    )


def _check_period(start: date | None, end: date | None) -> None:
    # A reversed period used to return 200 with no points, indistinguishable from "no observations"
    if start is not None and end is not None and end < start:
        raise InvalidRequestError("end must be on or after start")


def ndvi_series(p: Providers, farm_id: str, source_id: str, start: date | None, end: date | None) -> ObservationSeries:
    _check_period(start, end)
    series = p.observations.ndvi_series(farm_id, source_id)
    points = [pt for pt in series.points if (start is None or pt.date >= start) and (end is None or pt.date <= end)]
    return series.model_copy(update={"points": points})


def soil_moisture(p: Providers, farm_id: str, start: date | None, end: date | None) -> ObservationSeries:
    _check_period(start, end)
    series = p.observations.soil_moisture(farm_id)
    points = [pt for pt in series.points if (start is None or pt.date >= start) and (end is None or pt.date <= end)]
    return series.model_copy(update={"points": points})


def ndvi_overlay(p: Providers, farm_id: str) -> NdviOverlay:
    # Point farms have no pipeline PNG: render the latest clear Sentinel-2 date live (cached on disk)
    overlay = imagery_service.point_overlay(p, farm_id) if point_farm(farm_id) is not None else None
    if overlay is not None:
        return overlay
    overlay = p.observations.ndvi_overlay(farm_id)
    if overlay is None:
        raise DataNotFoundError(f"no NDVI overlay available for farm '{farm_id}' in {p.mode} mode")
    return overlay
