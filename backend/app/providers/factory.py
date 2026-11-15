"""Choose Real* or Synthetic* adapters from AGROX_DATA_MODE (default `real`)."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.config import Settings, get_settings
from app.providers.ports import CropCatalogProvider, FarmProvider, ObservationProvider, SoilProvider, WeatherProvider
from app.providers.real.catalog import RealCropCatalogProvider
from app.providers.real.farm import RealFarmProvider
from app.providers.real.observations import RealObservationProvider
from app.providers.real.soil import RealSoilProvider
from app.providers.real.weather import RealWeatherProvider
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
def _build(mode: str, derived_dir: Path, seed: int) -> Providers:
    if mode == "real" and RealWeatherProvider.is_available(derived_dir):
        soil_real = RealSoilProvider(derived_dir)
        return Providers(
            mode="real",
            weather=RealWeatherProvider(derived_dir),
            soil=soil_real,
            catalog=RealCropCatalogProvider(derived_dir),
            farm=RealFarmProvider(derived_dir, soil_real),
            observations=RealObservationProvider(derived_dir),
        )
    warnings: tuple[str, ...] = ()
    if mode == "real":
        warnings = ("AGROX_DATA_MODE=real but derived/ is missing: synthetic adapters are serving every port",)
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
    return _build(s.data_mode, s.derived_dir, s.synthetic_seed)
