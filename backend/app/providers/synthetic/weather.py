"""SyntheticWeatherProvider: seasonal cycle + AR(1) noise, Markov-chain rain with gamma amounts."""

from __future__ import annotations

import math
from datetime import date, timedelta
from functools import lru_cache

from app.providers.synthetic import params as P
from app.providers.synthetic import rng_for, source
from app.schemas.common import DataState, Location, Provenance
from app.schemas.weather import WeatherDay, WeatherSeries


@lru_cache(maxsize=4)
def _generate(seed: int) -> tuple[WeatherDay, ...]:
    rng = rng_for(seed, "weather")
    n = (P.END - P.START).days + 1
    days: list[WeatherDay] = []
    noise = 0.0
    wet = False
    for i in range(n):
        d = P.START + timedelta(days=i)
        doy = d.timetuple().tm_yday
        season = math.cos(2.0 * math.pi * (doy - P.T_PEAK_DOY) / 365.25)
        # AR(1) noise keeps warm and cold spells persistent across consecutive days
        noise = P.T_AR1 * noise + float(rng.normal(0.0, P.T_NOISE_SD))
        t_mean = P.T_MEAN_ANNUAL + P.T_AMPLITUDE * season + noise
        half_range = max(2.0, float(rng.normal(P.DIURNAL_RANGE_MEAN, P.DIURNAL_RANGE_SD))) / 2.0
        p_wet = P.P_WET_AFTER_WET if wet else P.P_WET_AFTER_DRY
        wet = bool(rng.uniform() < p_wet)
        scale = P.RAIN_GAMMA_SCALE_WINTER + (P.RAIN_GAMMA_SCALE_SUMMER - P.RAIN_GAMMA_SCALE_WINTER) * (season + 1) / 2
        precip = float(rng.gamma(P.RAIN_GAMMA_SHAPE, scale)) if wet else 0.0
        rh = min(100.0, max(20.0, P.RH_MEAN - P.RH_AMPLITUDE * season + float(rng.normal(0, P.RH_SD))))
        solar = max(1.0, P.SOLAR_MEAN + P.SOLAR_AMPLITUDE * season + float(rng.normal(0, P.SOLAR_SD)))
        # Wet days are cloudier: 30 % less radiation keeps rain and sunshine coherent
        if wet:
            solar *= 0.7
        wind = max(0.3, float(rng.normal(P.WIND_MEAN, P.WIND_SD)))
        days.append(
            WeatherDay(
                date=d,
                t_mean=round(t_mean, 2),
                t_max=round(t_mean + half_range, 2),
                t_min=round(t_mean - half_range, 2),
                precip=round(precip, 2),
                rh_mean=round(rh, 1),
                solar_rad=round(solar, 2),
                wind_2m=round(wind, 2),
            )
        )
    return tuple(days)


class SyntheticWeatherProvider:
    def __init__(self, seed: int) -> None:
        self._seed = seed

    def coverage(self) -> tuple[date, date]:
        return P.START, P.END

    def get_daily(self, start: date, end: date) -> WeatherSeries:
        days = [d for d in _generate(self._seed) if start <= d.date <= end]
        return WeatherSeries(
            location=Location(lat=P.LAT, lon=P.LON),
            elevation_m=P.ELEVATION_M,
            days=days,
            provenance=Provenance(
                source=source("weather"), data_state=DataState.SYNTHETIC, version=P.GENERATOR_VERSION
            ),
            warnings=["synthetic weather: does not represent the real parcel"],
        )
