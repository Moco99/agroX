"""Farm / observation use cases: load the farm with its zones, NDVI series, SMAP and the S2 overlay."""

from __future__ import annotations

from datetime import date

from app.providers.factory import Providers
from app.providers.ports import DataNotFoundError
from app.schemas.farm import FarmAnalyzeResponse
from app.schemas.observations import NdviOverlay, ObservationPoint, ObservationSeries


def latest_ndvi_by_zone(
    p: Providers, farm_id: str, on_or_before: date | None = None
) -> tuple[dict[str, ObservationPoint], ObservationSeries | None]:
    """Latest NDVI per zone, preferring the finer source (Sentinel-2) when it has a point in range."""
    best: dict[str, ObservationPoint] = {}
    chosen: ObservationSeries | None = None
    for source_id in ("sentinel2", "modis_ndvi"):
        if source_id not in p.observations.ndvi_sources():
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
    farm = p.farm.get_farm(farm_id)
    catalog = p.catalog.get_catalog()
    latest, series = latest_ndvi_by_zone(p, farm_id)
    warnings = list(p.warnings) + list(farm.warnings)
    for z in farm.zones:
        warnings.extend(f"{z.zone_id}: {w}" for w in z.soil.warnings)
    if any(not c.verified for c in catalog.crops):
        warnings.append("crop parameters are provisional (verified=false): literature values to verify")
    dates = [pt.date for pt in latest.values()]
    return FarmAnalyzeResponse(
        farm=farm,
        data_mode=p.mode,
        catalog_version=catalog.catalog_version,
        latest_ndvi={z.zone_id: (latest[z.zone_id].value if z.zone_id in latest else None) for z in farm.zones},
        latest_ndvi_date=max(dates).isoformat() if dates else None,
        latest_ndvi_source=series.source_id if series else None,
        warnings=list(dict.fromkeys(warnings)),
    )


def ndvi_series(p: Providers, farm_id: str, source_id: str, start: date | None, end: date | None) -> ObservationSeries:
    series = p.observations.ndvi_series(farm_id, source_id)
    points = [pt for pt in series.points if (start is None or pt.date >= start) and (end is None or pt.date <= end)]
    return series.model_copy(update={"points": points})


def soil_moisture(p: Providers, farm_id: str, start: date | None, end: date | None) -> ObservationSeries:
    series = p.observations.soil_moisture(farm_id)
    points = [pt for pt in series.points if (start is None or pt.date >= start) and (end is None or pt.date <= end)]
    return series.model_copy(update={"points": points})


def ndvi_overlay(p: Providers, farm_id: str) -> NdviOverlay:
    overlay = p.observations.ndvi_overlay(farm_id)
    if overlay is None:
        raise DataNotFoundError(f"no NDVI overlay available for farm '{farm_id}' in {p.mode} mode")
    return overlay
