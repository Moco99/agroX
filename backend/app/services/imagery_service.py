"""Read the bounded, georeferenced imagery artifacts produced by the pipeline."""

from __future__ import annotations

import io
from datetime import date

from PIL import Image

from app.config import get_settings
from app.engine.ndvi import colorize_ndvi
from app.providers.imagery.rasters import Grid, list_s2_scenes, read_scene_ndvi
from app.providers.ports import DataNotFoundError
from app.providers.real import provenance_from_manifest, read_json
from app.schemas.common import DataState
from app.schemas.imagery import (
    BasemapInfo,
    CatalogSource,
    DataCatalog,
    Heightmap,
    ImageryMeta,
    NdviDates,
    NdviSceneInfo,
)
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


def dates(farm_id: str) -> NdviDates:
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


def meta(farm_id: str) -> ImageryMeta:
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


def heightmap(farm_id: str) -> Heightmap:
    validate_farm(farm_id)
    raw = artifact(f"terrain/heightmap_{farm_id}.json")
    raw["provenance"] = provenance_from_manifest(
        get_settings().derived_dir, "terrain_heightmap", "NASADEM", DataState.MEASURED
    )
    return Heightmap.model_validate(raw)


def image(farm_id: str, size: int, day: date | None = None) -> bytes:
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
