"""Imagery and terrain: pipeline artifacts for the pilot, live Sentinel-2 / Copernicus DEM for point farms."""

from __future__ import annotations

import io
from datetime import date

from PIL import Image

from app.config import get_settings
from app.engine.ndvi import CLOUD_FREE_FRACTION, colorize_ndvi
from app.providers.factory import Providers
from app.providers.imagery.rasters import Grid, list_s2_scenes, read_scene_ndvi
from app.providers.live.imagery import DEM_PIXEL_M, S2_PIXEL_M, grid_shape
from app.providers.live.parcel import point_farm
from app.providers.ports import DataNotFoundError
from app.providers.real import provenance_from_manifest, read_json
from app.schemas.common import DataState, Provenance
from app.schemas.imagery import (
    BasemapInfo,
    CatalogSource,
    DataCatalog,
    Heightmap,
    ImageryMeta,
    NdviDates,
    NdviSceneInfo,
)
from app.services.farm_load_service import ensure_supported
from app.storage.factory import get_store
from app.storage.ports import ObjectNotFoundError, StoreUnavailableError


def artifact(relative: str) -> dict[str, object]:
    path = get_settings().derived_dir / relative
    if not path.is_file():
        raise DataNotFoundError("Imagery artifact unavailable; rebuild the imagery pipeline")
    return read_json(path)


def validate_farm(farm_id: str) -> None:
    if farm_id != "story_pilot_farm":
        raise DataNotFoundError("No imagery available for the requested farm")


def _point(p: Providers, farm_id: str) -> bool:
    """True for a point farm served live; 422/404 for bad ids or point farms outside live mode."""
    return ensure_supported(p, farm_id) is not None and p.point_imagery is not None


def dates(farm_id: str, p: Providers | None = None) -> NdviDates:
    if p is not None and _point(p, farm_id):
        return _point_dates(p, farm_id)
    validate_farm(farm_id)
    raw = artifact(f"obs/ndvi_s2_{farm_id}.meta.json")
    entries = raw.get("dates", [])
    points = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        day = date.fromisoformat(str(entry["date"]))
        points.append(
            NdviSceneInfo(
                date=day,
                valid_fraction=entry["farm_valid_fraction"],
                cloud_free=entry["cloud_free"],
                farm_ndvi_mean=entry.get("farm_ndvi_mean"),
                prerendered=(get_settings().derived_dir / f"imagery/ndvi/{day}.png").is_file(),
            )
        )
    return NdviDates(
        farm_id=farm_id,
        dates=points,
        cloud_free_threshold=float(str(raw["cloud_free_fraction"])),
        source="Sentinel-2 L2A",
        resolution_m=10,
        data_state=DataState.MEASURED,
        provenance=provenance_from_manifest(
            get_settings().derived_dir, "ndvi_s2", "Sentinel-2 L2A", DataState.MEASURED
        ),
    )


def meta(farm_id: str, p: Providers | None = None) -> ImageryMeta:
    if p is not None and _point(p, farm_id):
        return _point_meta(p, farm_id)
    validate_farm(farm_id)
    raw = artifact("imagery/meta.json")
    return ImageryMeta(
        farm_id=farm_id,
        bounds_wgs84=raw["bounds_wgs84"],
        crs=str(raw["crs"]),
        basemap=BasemapInfo.model_validate(raw["basemap"]),
        ndvi_dates=[p.date for p in dates(farm_id).dates],
        data_state=DataState.MEASURED,
        sources=[
            provenance_from_manifest(get_settings().derived_dir, "imagery_basemap", "USDA NAIP", DataState.MEASURED)
        ],
    )


def heightmap(farm_id: str, p: Providers | None = None) -> Heightmap:
    if p is not None and _point(p, farm_id):
        return _point_heightmap(p, farm_id)
    validate_farm(farm_id)
    raw = artifact(f"terrain/heightmap_{farm_id}.json")
    raw["provenance"] = provenance_from_manifest(
        get_settings().derived_dir, "terrain_heightmap", "NASADEM", DataState.MEASURED
    )
    return Heightmap.model_validate(raw)


def image(farm_id: str, size: int, day: date | None = None, p: Providers | None = None) -> bytes:
    if p is not None and _point(p, farm_id):
        return _point_image(p, farm_id, size, day)
    validate_farm(farm_id)
    relative = f"imagery/ndvi/{day}.png" if day else f"imagery/basemap_{farm_id}.jpg"
    path = get_settings().derived_dir / relative
    settings = get_settings()
    if day is not None and (settings.data_source == "s3" or not path.is_file()):
        try:
            store = get_store()
            scenes = [scene for scene in list_s2_scenes(store) if scene.date == day.isoformat()]
            if not scenes:
                raise ObjectNotFoundError("No Sentinel-2 scene for this date")
            bounds = meta(farm_id).bounds_wgs84
            width = min(size, 256)
            grid = Grid((bounds[0], bounds[1], bounds[2], bounds[3]), width, width)
            values, _ = read_scene_ndvi(store, scenes[-1], grid)
            output = io.BytesIO()
            Image.fromarray(colorize_ndvi(values)).save(output, "PNG")
            return output.getvalue()
        except ObjectNotFoundError as exc:
            if settings.data_source == "s3":
                raise DataNotFoundError("No remote image available for this date") from exc
        except StoreUnavailableError:
            if settings.data_source == "s3":
                raise
    if not path.is_file():
        raise DataNotFoundError("Image unavailable for this date")
    with Image.open(path) as source:
        source.thumbnail((size, size), Image.Resampling.NEAREST if day else Image.Resampling.LANCZOS)
        output = io.BytesIO()
        source.save(output, "PNG" if day else "JPEG")
    return output.getvalue()


# ─────────────────────────────────────────
# Section: Point farms (live Sentinel-2 / Copernicus DEM)
# ─────────────────────────────────────────

S2_PROVENANCE = Provenance(
    source="Sentinel-2 L2A via Planetary Computer API (live)",
    data_state=DataState.MEASURED,
    resolution="10 m (SCL 20 m)",
)


def _point_dates(p: Providers, farm_id: str) -> NdviDates:
    """Dates of the live per-zone series, with the farm mean weighted by clear pixels."""
    assert p.live_observations is not None and p.point_imagery is not None
    p.observations.ndvi_series(farm_id, "sentinel2")
    rows = p.live_observations.cached_rows(farm_id) or []
    total = max(p.live_observations.farm_pixel_total(farm_id), 1)
    by_date: dict[str, list[tuple[float, int]]] = {}
    for r in rows:
        by_date.setdefault(str(r["date"]), []).append((float(str(r["ndvi"])), int(str(r["n_pixels"]))))
    points: list[NdviSceneInfo] = []
    for day, vals in sorted(by_date.items()):
        n = sum(c for _, c in vals)
        # Overlapping tiles add their pixels: cap at 1 so the fraction stays a share of the farm
        fraction = round(min(1.0, n / total), 3)
        points.append(
            NdviSceneInfo(
                date=date.fromisoformat(day),
                valid_fraction=fraction,
                cloud_free=fraction >= CLOUD_FREE_FRACTION,
                farm_ndvi_mean=round(sum(v * c for v, c in vals) / n, 4) if n else None,
                prerendered=p.point_imagery.has_ndvi_png(farm_id, date.fromisoformat(day)),
            )
        )
    return NdviDates(
        farm_id=farm_id,
        dates=points,
        cloud_free_threshold=CLOUD_FREE_FRACTION,
        source="Sentinel-2 L2A",
        resolution_m=S2_PIXEL_M,
        data_state=DataState.MEASURED,
        provenance=S2_PROVENANCE,
        warnings=[
            f"{len(points)} dates with clear pixels since 2021 (scenes with cloud < 30 %); "
            "valid_fraction = clear share of the farm zones"
        ],
    )


def _point_meta(p: Providers, farm_id: str) -> ImageryMeta:
    """Fast: reads what is cached and never builds the basemap nor the NDVI series."""
    assert p.point_imagery is not None and p.live_observations is not None
    bounds = p.point_imagery.bounds(farm_id)
    info = p.point_imagery.basemap_info(farm_id)
    width, height = grid_shape(bounds, S2_PIXEL_M)
    warnings: list[str] = []
    if info is None:
        warnings.append("basemap not built yet: GET /api/imagery/basemap builds it (~3-10 s) or wait for the load job")
        basemap = BasemapInfo(width=width, height=height, source="Sentinel-2 L2A TCI composite (pending)",
                              resolution_m=S2_PIXEL_M)
    else:
        basemap = BasemapInfo.model_validate(info)
    rows = p.live_observations.cached_rows(farm_id)
    if rows is None:
        warnings.append("NDVI dates still loading: GET /api/imagery/ndvi/dates waits for them")
    ndvi_dates = sorted({date.fromisoformat(str(r["date"])) for r in rows or []})
    return ImageryMeta(
        farm_id=farm_id,
        bounds_wgs84=list(bounds),
        crs="EPSG:4326",
        basemap=basemap,
        ndvi_dates=ndvi_dates,
        data_state=DataState.MEASURED,
        sources=[
            S2_PROVENANCE.model_copy(update={"method": "basemap: median of clear TCI scenes; NDVI: B04/B08 + SCL"}),
            Provenance(source="Copernicus DEM GLO-30 (Planetary Computer)", data_state=DataState.MEASURED,
                       resolution="30 m"),
        ],
        warnings=[
            *warnings,
            "true colour is Sentinel-2 at 10 m (not an aerial photo): fields smaller than ~1 ha look blurry",
        ],
    )


def _floats(value: object) -> list[float]:
    return [float(str(v)) for v in value] if isinstance(value, list) else []


def _point_heightmap(p: Providers, farm_id: str) -> Heightmap:
    assert p.point_imagery is not None
    doc = p.point_imagery.heightmap(farm_id)
    tiles = doc.get("tiles")
    tile_ids = ", ".join(str(t) for t in tiles) if isinstance(tiles, list) else "n/a"
    return Heightmap(
        farm_id=farm_id,
        bounds_wgs84=_floats(doc["bounds_wgs84"]),
        width=int(str(doc["width"])),
        height=int(str(doc["height"])),
        min_m=float(str(doc["min_m"])),
        max_m=float(str(doc["max_m"])),
        resolution_m=float(str(doc["resolution_m"])),
        row_order=str(doc["row_order"]),
        data=_floats(doc["data"]),
        data_state=DataState.MEASURED,
        provenance=Provenance(
            source="Copernicus DEM GLO-30 via Planetary Computer API (live)",
            data_state=DataState.MEASURED,
            resolution=f"{DEM_PIXEL_M:g} m",
            method=f"cropped to the imagery bounds; tiles {tile_ids}",
        ),
        note=(
            "30 m source (Copernicus DEM, a surface model: trees and buildings add height). "
            "Use for illustrative 3D terrain, not for hydrology or engineering."
        ),
        warnings=[f"nodata cells filled with the mean: {doc.get('nodata_fraction')}"]
        if float(str(doc.get("nodata_fraction", 0))) > 0
        else [],
    )


def _point_image(p: Providers, farm_id: str, size: int, day: date | None) -> bytes:
    assert p.point_imagery is not None
    data = p.point_imagery.ndvi_png(farm_id, day) if day else p.point_imagery.basemap(farm_id)[0]
    with Image.open(io.BytesIO(data)) as source:
        if max(source.size) <= size:
            return data
        source.thumbnail((size, size), Image.Resampling.NEAREST if day else Image.Resampling.LANCZOS)
        output = io.BytesIO()
        source.save(output, "PNG" if day else "JPEG")
        return output.getvalue()


def basemap_headers(farm_id: str, p: Providers | None) -> dict[str, str]:
    """Source/date/resolution of the basemap as response headers (the image itself carries no metadata)."""
    if p is None or point_farm(farm_id) is None or p.point_imagery is None:
        return {"X-Imagery-Source": "USDA NAIP", "X-Imagery-Resolution-M": "1.0"}
    info = p.point_imagery.basemap_info(farm_id) or {}
    return {
        "X-Imagery-Source": "Sentinel-2 L2A TCI median composite",
        "X-Imagery-Acquired": str(info.get("acquired", "")),
        "X-Imagery-Acquired-From": str(info.get("acquired_from", "")),
        "X-Imagery-Resolution-M": f"{S2_PIXEL_M:g}",
        "X-Imagery-Clear-Fraction": str(info.get("clear_fraction", "")),
    }


def catalog() -> DataCatalog:
    from app.storage.ports import PROCESS_TOTALS

    settings = get_settings()
    store = get_store()
    accessible = store.s3_available()
    objects = store.list_objects("")
    grouped: dict[str, list[int]] = {}
    for obj in objects:
        grouped.setdefault(obj.key.split("/")[0], []).append(obj.size)
    derived_size = sum(p.stat().st_size for p in settings.derived_dir.rglob("*") if p.is_file())
    cache_size = sum(p.stat().st_size for p in settings.cache_dir.rglob("*.blk") if p.is_file())
    return DataCatalog(
        mode=store.mode,
        requested_source=settings.data_source,
        s3_configured=store.configured,
        s3_accessible=accessible,
        s3_detail=store.s3_error,
        local_available=settings.raw_dir.is_dir(),
        sources=[
            CatalogSource(source_id=k, files=len(v), size_mb=sum(v) / 1024**2) for k, v in sorted(grouped.items())
        ],
        total_files=len(objects),
        total_size_mb=sum(o.size for o in objects) / 1024**2,
        derived_size_mb=derived_size / 1024**2,
        cache_size_mb=cache_size / 1024**2,
        cache_max_mb=settings.cache_max_mb,
        transfer_since_start={
            "network_bytes": PROCESS_TOTALS.network_bytes,
            "cache_bytes": PROCESS_TOTALS.cache_bytes,
            "requests": PROCESS_TOTALS.requests,
        },
    )
