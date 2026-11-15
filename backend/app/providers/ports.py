"""Ports (Protocols) between services and data adapters.

Real* adapters read `app/data/derived/` (built by `pipeline/`), Synthetic* adapters
generate deterministic data from a seed. Both must return exactly the same models
(enforced by tests/contract).
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from app.schemas.crops import CropCatalog
from app.schemas.farm import Farm
from app.schemas.observations import NdviOverlay, ObservationSeries
from app.schemas.soil import SoilProfile
from app.schemas.weather import WeatherSeries


class DataNotFoundError(LookupError):
    """Requested farm/zone/source does not exist for the active adapter (API maps it to 404)."""


class WeatherProvider(Protocol):
    def coverage(self) -> tuple[date, date]: ...

    def get_daily(self, start: date, end: date) -> WeatherSeries: ...


class SoilProvider(Protocol):
    def get_zone_soils(self, farm_id: str) -> dict[str, SoilProfile]: ...


class CropCatalogProvider(Protocol):
    def get_catalog(self) -> CropCatalog: ...


class FarmProvider(Protocol):
    def farm_ids(self) -> list[str]: ...

    def get_farm(self, farm_id: str) -> Farm: ...


class ObservationProvider(Protocol):
    def ndvi_sources(self) -> list[str]: ...

    def ndvi_series(self, farm_id: str, source_id: str) -> ObservationSeries: ...

    def soil_moisture(self, farm_id: str) -> ObservationSeries: ...

    def ndvi_overlay(self, farm_id: str) -> NdviOverlay | None: ...
