"""Climate use case: daily series + period indicators with explicit data limits (Earth Scanner)."""

from __future__ import annotations

from datetime import date

from app.engine.indicators import period_indicators, precip_anomaly_pct
from app.engine.spi import MIN_YEARS as SPI_MIN_YEARS
from app.engine.spi import spi
from app.providers.factory import Providers, weather_at
from app.providers.ports import WeatherProvider
from app.schemas.climate import ClimateIndicators, ClimateResponse
from app.schemas.common import DataState, Metric
from app.services.errors import InvalidRequestError

GDD_BASE_C = 10.0
# Product thresholds for "hot" and "cold" days in the indicator panel (corn-oriented, documented in decisions)
HOT_THRESHOLD_C = 32.0
COLD_THRESHOLD_C = 0.0
# Distance in degrees beyond which the request is answered with the pilot series plus a warning
MAX_POINT_OFFSET_DEG = 0.25


def _same_period_other_years(w: WeatherProvider, start: date, end: date) -> list[float]:
    """Totals of the same calendar window in every other complete year the provider covers."""
    cov_start, cov_end = w.coverage()
    totals: list[float] = []
    for year in range(cov_start.year, cov_end.year + 1):
        if year == start.year:
            continue
        try:
            s, e = start.replace(year=year), end.replace(year=year + (end.year - start.year))
        except ValueError:
            continue
        if s < cov_start or e > cov_end:
            continue
        totals.append(sum(d.precip for d in w.get_daily(s, e).days))
    return totals


def get_climate(p: Providers, start: date, end: date, lat: float | None, lon: float | None) -> ClimateResponse:
    if end < start:
        raise InvalidRequestError("end must be on or after start")
    if (end - start).days > 800:
        raise InvalidRequestError("period longer than 800 days")
    # In live mode a requested point gets its own NASA POWER series; otherwise the pilot series answers
    w = weather_at(p, lat, lon) if lat is not None and lon is not None and p.mode == "live" else p.weather
    series = w.get_daily(start, end)
    if not series.days:
        cov = w.coverage()
        raise InvalidRequestError(f"no weather data in {start}..{end}; coverage is {cov[0]}..{cov[1]}")
    warnings = list(p.warnings) + list(series.warnings)
    if lat is not None and lon is not None:
        far = max(abs(lat - series.location.lat), abs(lon - series.location.lon)) > MAX_POINT_OFFSET_DEG
        if far:
            warnings.append("requested point is outside the pilot area: the pilot POWER series is returned")
    ind = period_indicators(
        series.days, series.location.lat, series.elevation_m, GDD_BASE_C, HOT_THRESHOLD_C, COLD_THRESHOLD_C
    )
    state = series.provenance.data_state
    # Derived from measured inputs through a model => ESTIMATED (SYNTHETIC propagates)
    derived = DataState.SYNTHETIC if state is DataState.SYNTHETIC else DataState.ESTIMATED
    src = series.provenance.source
    reference = _same_period_other_years(w, series.days[0].date, series.days[-1].date)
    # Fewer than 10 reference years cannot define a climatology: the anomaly is withheld rather than overstated
    anomaly = precip_anomaly_pct(ind.precip_total, reference) if len(reference) >= 10 else None
    if anomaly is None:
        warnings.append(
            f"precipitation anomaly needs >= 10 reference years (have {len(reference)}): "
            "requires POWER history since 1981 (open item O-7)"
        )
    spi_value = spi(ind.precip_total, reference)
    if spi_value is None:
        warnings.append(f"SPI needs >= {SPI_MIN_YEARS} reference years (have {len(reference)}): AGROX_DATA_MODE=live")
    indicators = ClimateIndicators(
        start=series.days[0].date,
        end=series.days[-1].date,
        days=ind.days,
        precip_total=Metric(value=ind.precip_total, unit="mm", data_state=state, source=src),
        t_mean=Metric(value=ind.t_mean, unit="C", data_state=state, source=src),
        t_max_mean=Metric(value=ind.t_max_mean, unit="C", data_state=state, source=src),
        t_min_mean=Metric(value=ind.t_min_mean, unit="C", data_state=state, source=src),
        solar_mean=Metric(value=ind.solar_mean, unit="MJ/m2/day", data_state=state, source=src),
        et0_total=Metric(value=ind.et0_total, unit="mm", data_state=derived, source="FAO-56 " + ind.et0_method),
        et0_method=ind.et0_method,
        gdd_total=Metric(value=ind.gdd_total, unit="C-day", data_state=derived, source="simple average method"),
        gdd_base_c=GDD_BASE_C,
        frost_days=Metric(value=float(ind.frost_days), unit="days", data_state=state, source=src),
        hot_days=Metric(value=float(ind.hot_days), unit="days", data_state=state, source=src),
        hot_threshold_c=HOT_THRESHOLD_C,
        cold_days=Metric(value=float(ind.cold_days), unit="days", data_state=state, source=src),
        cold_threshold_c=COLD_THRESHOLD_C,
        precip_anomaly_pct=Metric(value=anomaly, unit="%", data_state=derived, source="same window, other years"),
        spi=Metric(value=spi_value, unit="index", data_state=derived, source="McKee 1993, gamma (Thom), same window"),
    )
    return ClimateResponse(
        data_mode=p.mode,
        series=series,
        indicators=indicators,
        warnings=warnings,
        provenance=series.provenance,
    )
