"""Choose Real*, Live* or Synthetic* adapters from AGROX_DATA_MODE (default `real`).

`live`: weather (NASA POWER 1981 -> today), Sentinel-2 NDVI per zone (Planetary Computer) and soil
(SSURGO + SoilGrids cross-check / fallback) come from the source APIs; parcel, catalog, MODIS and SMAP
stay Real* because the pilot parcel is defined by the pipeline. Only `live` serves point farms
(`pt_<lat>_<lon>`), with imagery, terrain and land cover fetched on demand into the live cache.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.config import DEFAULT_CACHE_DIR, DEFAULT_LIVE_CACHE_DIR, Settings, get_settings
from app.providers.live.farm import GlobalFarmProvider
from app.providers.live.imagery import PointImageryProvider
from app.providers.live.land_cover import LandCoverProvider
from app.providers.live.observations import LiveObservationProvider
from app.providers.live.parcel import point_farm
from app.providers.live.projection import ProjectionProvider
from app.providers.live.soil import LiveSoilProvider
from app.providers.live.weather import LivePowerWeatherProvider
from app.providers.ports import (
    CropCatalogProvider,
    DataNotFoundError,
    FarmProvider,
    ObservationProvider,
    SoilProvider,
    WeatherProvider,
)
from app.providers.real import read_json
from app.providers.real.catalog import RealCropCatalogProvider
from app.providers.real.farm import RealFarmProvider
from app.providers.real.observations import RealObservationProvider
from app.providers.real.soil import RealSoilProvider
from app.providers.real.weather import WEATHER_META, RealWeatherProvider
from app.providers.synthetic.catalog import SyntheticCropCatalogProvider
from app.providers.synthetic.farm import SyntheticFarmProvider, SyntheticSoilProvider
from app.providers.synthetic.observations import SyntheticObservationProvider
from app.providers.synthetic.weather import SyntheticWeatherProvider


@dataclass(frozen=True)
class Providers:
    mode: str
    weather: WeatherProvider
    soil: SoilProvider
    catalog: CropCatalogProvider
    farm: FarmProvider
    observations: ObservationProvider
    # Ports that silently fell back would be dishonest: the reason travels to every response
    warnings: tuple[str, ...] = field(default_factory=tuple)
    derived_dir: Path | None = None
    cache_dir: Path | None = None
    # Live-only adapters (None in real/synthetic): point-farm imagery, land cover and soil fetch status
    point_imagery: PointImageryProvider | None = None
    land_cover: LandCoverProvider | None = None
    live_soil: LiveSoilProvider | None = None
    live_observations: LiveObservationProvider | None = None
    # Opt-in CMIP6 projections for future windows (network); None in synthetic mode
    projection: ProjectionProvider | None = None

    @property
    def any_parcel_supported(self) -> bool:
        """Point farms (pt_<lat>_<lon>) need the live adapters."""
        return self.mode == "live"


POINT_FARMS_NEED_LIVE = (
    "point farms (pt_<lat>_<lon>) and weather outside the pilot need AGROX_DATA_MODE=live "
    "(check `any_parcel_supported` in /api/health; `make dev-live`)"
)


@lru_cache(maxsize=8)
def _build(
    mode: str,
    derived_dir: Path,
    seed: int,
    cache_dir: Path | None = None,
    live_cache_dir: Path = DEFAULT_LIVE_CACHE_DIR,
    live_cache_max_mb: int = 256,
) -> Providers:
    if mode in ("real", "live") and RealWeatherProvider.is_available(derived_dir):
        cache = cache_dir or DEFAULT_CACHE_DIR
        soil_real: SoilProvider = RealSoilProvider(derived_dir)
        weather: WeatherProvider = RealWeatherProvider(derived_dir)
        observations: ObservationProvider = RealObservationProvider(derived_dir)
        live_soil: LiveSoilProvider | None = None
        live_obs: LiveObservationProvider | None = None
        if mode == "live":
            soil_real = live_soil = LiveSoilProvider(derived_dir, live_cache_dir)
            observations = live_obs = LiveObservationProvider(derived_dir, cache)
            # Same point as the derived series so both modes describe the same pilot cell
            loc = read_json(derived_dir / WEATHER_META).get("location")
            loc = loc if isinstance(loc, dict) else {}
            weather = LivePowerWeatherProvider(
                derived_dir,
                cache,
                float(loc.get("lat", 41.995)),
                float(loc.get("lon", -93.49)),
            )
        return Providers(
            mode=mode,
            weather=weather,
            soil=soil_real,
            catalog=RealCropCatalogProvider(derived_dir),
            farm=GlobalFarmProvider(derived_dir, soil_real, cache)
            if mode == "live"
            else RealFarmProvider(derived_dir, soil_real),
            observations=observations,
            derived_dir=derived_dir,
            cache_dir=cache,
            point_imagery=PointImageryProvider(live_cache_dir, live_cache_max_mb) if mode == "live" else None,
            land_cover=LandCoverProvider(live_cache_dir) if mode == "live" else None,
            live_soil=live_soil,
            live_observations=live_obs,
            projection=ProjectionProvider(cache),
        )
    warnings: tuple[str, ...] = ()
    if mode in ("real", "live"):
        warnings = (f"AGROX_DATA_MODE={mode} but derived/ is missing: synthetic adapters are serving every port",)
    soil_syn = SyntheticSoilProvider()
    return Providers(
        mode="synthetic",
        weather=SyntheticWeatherProvider(seed),
        soil=soil_syn,
        catalog=SyntheticCropCatalogProvider(),
        farm=SyntheticFarmProvider(soil_syn),
        observations=SyntheticObservationProvider(seed),
        warnings=warnings,
    )


def get_providers(settings: Settings | None = None) -> Providers:
    s = settings or get_settings()
    return _build(s.data_mode, s.derived_dir, s.synthetic_seed, s.cache_dir, s.live_cache_dir, s.live_cache_max_mb)


@lru_cache(maxsize=64)
def _point_weather(derived_dir: Path, cache_dir: Path, lat: float, lon: float) -> LivePowerWeatherProvider:
    return LivePowerWeatherProvider(derived_dir, cache_dir, lat, lon, allow_fallback=False)


def weather_at(p: Providers, lat: float, lon: float) -> WeatherProvider:
    """NASA POWER at any point (live mode only)."""
    if p.mode != "live" or p.derived_dir is None or p.cache_dir is None:
        raise DataNotFoundError(POINT_FARMS_NEED_LIVE)
    return _point_weather(p.derived_dir, p.cache_dir, round(lat, 4), round(lon, 4))


def weather_for(p: Providers, farm_id: str) -> WeatherProvider:
    """Weather provider for a farm: the pilot series, or NASA POWER at the point of a point farm."""
    pt = point_farm(farm_id)
    return p.weather if pt is None else weather_at(p, *pt)
