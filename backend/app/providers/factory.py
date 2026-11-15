"""Choose Real*, Live* or Synthetic* adapters from AGROX_DATA_MODE (default `real`).

`live`: weather comes straight from the NASA POWER API (1981 -> today); the other ports stay Real*
because the pilot parcel, its soil and NDVI are defined by the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.config import DEFAULT_CACHE_DIR, Settings, get_settings
from app.providers.live.weather import LivePowerWeatherProvider
from app.providers.ports import CropCatalogProvider, FarmProvider, ObservationProvider, SoilProvider, WeatherProvider
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


@lru_cache(maxsize=8)
def _build(mode: str, derived_dir: Path, seed: int, cache_dir: Path | None = None) -> Providers:
    if mode in ("real", "live") and RealWeatherProvider.is_available(derived_dir):
        soil_real = RealSoilProvider(derived_dir)
        weather: WeatherProvider = RealWeatherProvider(derived_dir)
        if mode == "live":
            # Same point as the derived series so both modes describe the same pilot cell
            loc = read_json(derived_dir / WEATHER_META).get("location")
            loc = loc if isinstance(loc, dict) else {}
            weather = LivePowerWeatherProvider(
                derived_dir,
                cache_dir or DEFAULT_CACHE_DIR,
                float(loc.get("lat", 41.995)),
                float(loc.get("lon", -93.49)),
            )
        return Providers(
            mode=mode,
            weather=weather,
            soil=soil_real,
            catalog=RealCropCatalogProvider(derived_dir),
            farm=RealFarmProvider(derived_dir, soil_real),
            observations=RealObservationProvider(derived_dir),
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
    return _build(s.data_mode, s.derived_dir, s.synthetic_seed, s.cache_dir)
