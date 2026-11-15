"""Climate indicators for a period (Earth Scanner, models 1/2/5/8/10)."""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.et0 import daily_et0
from app.schemas.weather import WeatherDay


@dataclass(frozen=True)
class PeriodIndicators:
    days: int
    precip_total: float
    t_mean: float
    t_max_mean: float
    t_min_mean: float
    solar_mean: float
    et0_total: float
    et0_method: str
    gdd_total: float
    frost_days: int
    hot_days: int
    cold_days: int


def period_indicators(
    days: list[WeatherDay],
    lat: float,
    elevation_m: float,
    gdd_base_c: float,
    hot_threshold_c: float,
    cold_threshold_c: float,
) -> PeriodIndicators:
    n = len(days)
    if n == 0:
        return PeriodIndicators(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "none", 0.0, 0, 0, 0)
    et0_total = 0.0
    methods: set[str] = set()
    for d in days:
        r = daily_et0(
            d.t_max, d.t_min, d.rh_mean, d.solar_rad, d.wind_2m, lat, elevation_m, d.date.timetuple().tm_yday, d.t_mean
        )
        et0_total += r.et0_mm
        methods.add(r.method)
    return PeriodIndicators(
        days=n,
        precip_total=round(sum(d.precip for d in days), 1),
        t_mean=round(sum(d.t_mean for d in days) / n, 2),
        t_max_mean=round(sum(d.t_max for d in days) / n, 2),
        t_min_mean=round(sum(d.t_min for d in days) / n, 2),
        solar_mean=round(sum(d.solar_rad for d in days) / n, 2),
        et0_total=round(et0_total, 1),
        et0_method="+".join(sorted(methods)),
        gdd_total=round(sum(max(0.0, (d.t_max + d.t_min) / 2 - gdd_base_c) for d in days), 1),
        frost_days=sum(1 for d in days if d.t_min < 0.0),
        hot_days=sum(1 for d in days if d.t_max > hot_threshold_c),
        cold_days=sum(1 for d in days if d.t_min < cold_threshold_c),
    )


def precip_anomaly_pct(period_total: float, reference_totals: list[float]) -> float | None:
    """Model 8: needs a climatology of the same period; None when it is unavailable or zero."""
    if not reference_totals:
        return None
    mean = sum(reference_totals) / len(reference_totals)
    if mean <= 0:
        return None
    return round((period_total - mean) / mean * 100.0, 1)
