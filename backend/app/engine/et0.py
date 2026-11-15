"""Reference evapotranspiration: FAO-56 Penman-Monteith (daily) with Hargreaves fallback.

Equation numbers refer to Allen et al. (1998), FAO Irrigation and Drainage Paper 56.
All functions are pure and work on scalars so the daily loop stays explicit.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SOLAR_CONSTANT = 0.0820  # MJ m-2 min-1 (eq. 21 constant Gsc)
ALBEDO_REFERENCE = 0.23  # grass reference surface (eq. 38)
STEFAN_BOLTZMANN = 4.903e-9  # MJ K-4 m-2 day-1 (eq. 39)


@dataclass(frozen=True)
class Et0Result:
    et0_mm: float
    method: str
    rn_mj: float | None
    es_kpa: float
    ea_kpa: float


# ─────────────────────────────────────────
# Section: Atmospheric helpers
# ─────────────────────────────────────────


def atmospheric_pressure_kpa(elevation_m: float) -> float:
    """Eq. 7: P = 101.3 * ((293 - 0.0065 z) / 293) ^ 5.26."""
    # math.pow keeps the return type float for mypy (float ** float is typed as Any)
    return 101.3 * math.pow((293.0 - 0.0065 * elevation_m) / 293.0, 5.26)


def psychrometric_constant(pressure_kpa: float) -> float:
    """Eq. 8: gamma = 0.000665 * P."""
    return 0.000665 * pressure_kpa


def saturation_vapour_pressure(t_c: float) -> float:
    """Eq. 11: e(T) = 0.6108 exp(17.27 T / (T + 237.3))."""
    return 0.6108 * math.exp(17.27 * t_c / (t_c + 237.3))


def slope_vapour_pressure_curve(t_c: float) -> float:
    """Eq. 13: Delta = 4098 e(T) / (T + 237.3)^2."""
    return 4098.0 * saturation_vapour_pressure(t_c) / (t_c + 237.3) ** 2


def mean_saturation_vapour_pressure(t_max: float, t_min: float) -> float:
    """Eq. 12: es = (e(Tmax) + e(Tmin)) / 2."""
    return (saturation_vapour_pressure(t_max) + saturation_vapour_pressure(t_min)) / 2.0


def actual_vapour_pressure_from_rh_mean(t_max: float, t_min: float, rh_mean_pct: float) -> float:
    """Eq. 19: ea = RHmean/100 * (e(Tmax) + e(Tmin)) / 2 (only RH mean is available from POWER)."""
    return rh_mean_pct / 100.0 * mean_saturation_vapour_pressure(t_max, t_min)


# ─────────────────────────────────────────
# Section: Radiation
# ─────────────────────────────────────────


def extraterrestrial_radiation(lat_deg: float, day_of_year: int) -> float:
    """Eq. 21-24: Ra in MJ m-2 day-1 from latitude and day of year."""
    phi = math.radians(lat_deg)
    dr = 1.0 + 0.033 * math.cos(2.0 * math.pi / 365.0 * day_of_year)
    delta = 0.409 * math.sin(2.0 * math.pi / 365.0 * day_of_year - 1.39)
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))
    return (
        24.0
        * 60.0
        / math.pi
        * SOLAR_CONSTANT
        * dr
        * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))
    )


def clear_sky_radiation(ra_mj: float, elevation_m: float) -> float:
    """Eq. 37: Rso = (0.75 + 2e-5 z) Ra."""
    return (0.75 + 2e-5 * elevation_m) * ra_mj


def net_radiation(rs_mj: float, ra_mj: float, elevation_m: float, t_max: float, t_min: float, ea_kpa: float) -> float:
    """Eq. 38-40: Rn = Rns - Rnl with Rns = (1 - albedo) Rs and the FAO-56 longwave formula."""
    rns = (1.0 - ALBEDO_REFERENCE) * rs_mj
    rso = clear_sky_radiation(ra_mj, elevation_m)
    # Rs/Rso is bounded to [0.3, 1.0] as FAO-56 recommends to avoid night/overcast artefacts
    ratio = 1.0 if rso <= 0 else max(0.3, min(1.0, rs_mj / rso))
    tmax_k4 = (t_max + 273.16) ** 4
    tmin_k4 = (t_min + 273.16) ** 4
    rnl = (
        STEFAN_BOLTZMANN
        * (tmax_k4 + tmin_k4)
        / 2.0
        * (0.34 - 0.14 * math.sqrt(max(ea_kpa, 0.0)))
        * (1.35 * ratio - 0.35)
    )
    return rns - rnl


# ─────────────────────────────────────────
# Section: ET0 methods
# ─────────────────────────────────────────


def penman_monteith(
    t_max: float,
    t_min: float,
    rh_mean_pct: float,
    rs_mj: float,
    wind_2m: float,
    lat_deg: float,
    elevation_m: float,
    day_of_year: int,
    t_mean: float | None = None,
) -> Et0Result:
    """Eq. 6, daily step with G = 0.

    t_mean defaults to (Tmax + Tmin)/2 (FAO-56 eq. 9); POWER's T2M is a true 24 h mean and may be passed
    explicitly, the difference is documented as expected.
    """
    t = (t_max + t_min) / 2.0 if t_mean is None else t_mean
    pressure = atmospheric_pressure_kpa(elevation_m)
    gamma = psychrometric_constant(pressure)
    delta = slope_vapour_pressure_curve(t)
    es = mean_saturation_vapour_pressure(t_max, t_min)
    ea = min(actual_vapour_pressure_from_rh_mean(t_max, t_min, rh_mean_pct), es)
    ra = extraterrestrial_radiation(lat_deg, day_of_year)
    rn = net_radiation(rs_mj, ra, elevation_m, t_max, t_min, ea)
    g = 0.0
    numerator = 0.408 * delta * (rn - g) + gamma * (900.0 / (t + 273.0)) * wind_2m * (es - ea)
    denominator = delta + gamma * (1.0 + 0.34 * wind_2m)
    et0 = max(0.0, numerator / denominator)
    return Et0Result(et0_mm=et0, method="penman_monteith_fao56", rn_mj=rn, es_kpa=es, ea_kpa=ea)


def hargreaves(t_max: float, t_min: float, lat_deg: float, day_of_year: int, t_mean: float | None = None) -> Et0Result:
    """Eq. 52: ET0 = 0.0023 (Tmean + 17.8) (Tmax - Tmin)^0.5 Ra, with Ra in mm/day (x 0.408)."""
    t = (t_max + t_min) / 2.0 if t_mean is None else t_mean
    ra_mm = 0.408 * extraterrestrial_radiation(lat_deg, day_of_year)
    et0 = max(0.0, 0.0023 * (t + 17.8) * math.sqrt(max(t_max - t_min, 0.0)) * ra_mm)
    es = mean_saturation_vapour_pressure(t_max, t_min)
    return Et0Result(et0_mm=et0, method="hargreaves", rn_mj=None, es_kpa=es, ea_kpa=float("nan"))


def daily_et0(
    t_max: float,
    t_min: float,
    rh_mean_pct: float | None,
    rs_mj: float | None,
    wind_2m: float | None,
    lat_deg: float,
    elevation_m: float,
    day_of_year: int,
    t_mean: float | None = None,
) -> Et0Result:
    """Penman-Monteith when RH, radiation and wind are all present and finite; Hargreaves otherwise."""
    inputs = (rh_mean_pct, rs_mj, wind_2m)
    if all(v is not None and math.isfinite(v) for v in inputs):
        assert rh_mean_pct is not None and rs_mj is not None and wind_2m is not None
        return penman_monteith(t_max, t_min, rh_mean_pct, rs_mj, wind_2m, lat_deg, elevation_m, day_of_year, t_mean)
    return hargreaves(t_max, t_min, lat_deg, day_of_year, t_mean)
