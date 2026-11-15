"""Observed coverage and explicit historical analogue weather for simulations."""

from __future__ import annotations

from datetime import date, timedelta

from app.providers.ports import WeatherProvider
from app.schemas.common import DataState
from app.schemas.weather import WeatherSeries
from app.services.errors import InvalidRequestError


def observed_coverage(provider: WeatherProvider) -> dict[str, object]:
    start, end = provider.coverage()
    series = provider.get_daily(start, end)
    available = {day.date for day in series.days}
    missing: list[dict[str, str]] = []
    current = start
    while current <= end:
        if current in available:
            current += timedelta(days=1)
            continue
        first = current
        while current <= end and current not in available:
            current += timedelta(days=1)
        missing.append({"start": first.isoformat(), "end": (current - timedelta(days=1)).isoformat()})
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "missing": missing,
        "available_days": len(available),
        "source": series.provenance.source,
        "data_state": series.provenance.data_state.value,
        "warnings": series.warnings,
    }


def analogue_weather(
    provider: WeatherProvider, start: date, end: date, reference_year: int, target_anchor_year: int | None = None
) -> WeatherSeries:
    """Map reference-year daily observations to target dates; never interpolate a missing day."""
    anchor = start.year if target_anchor_year is None else target_anchor_year
    pairs: list[tuple[date, date]] = []
    target = start
    leap_adjusted = False
    while target <= end:
        year = reference_year + target.year - anchor
        try:
            reference = target.replace(year=year)
        except ValueError as exc:
            if target.month != 2 or target.day != 29:
                raise InvalidRequestError("Año de referencia fuera de rango") from exc
            reference = date(year, 2, 28)
            leap_adjusted = True
        pairs.append((target, reference))
        target += timedelta(days=1)
    if not pairs:
        raise InvalidRequestError("El periodo debe estar ordenado")
    source = provider.get_daily(min(ref for _, ref in pairs), max(ref for _, ref in pairs))
    lookup = {day.date: day for day in source.days}
    missing = sorted({ref for _, ref in pairs if ref not in lookup})
    if missing:
        raise InvalidRequestError(
            f"El año de referencia no contiene datos completos; falta {missing[0]}. Elige otro año."
        )
    state = DataState.SYNTHETIC if source.provenance.data_state == DataState.SYNTHETIC else DataState.SIMULATED
    warnings = list(source.warnings)
    warnings.append(
        f"Clima histórico de referencia {reference_year}, trasladado por mes y día: simulación, no pronóstico."
    )
    if leap_adjusted:
        warnings.append("El 29 de febrero se representa con el 28 de febrero del año histórico.")
    return source.model_copy(
        update={
            "days": [lookup[ref].model_copy(update={"date": dest}) for dest, ref in pairs],
            "provenance": source.provenance.model_copy(
                update={
                    "data_state": state,
                    "method": f"Historical analogue from {reference_year}; calendar dates mapped to simulation window.",
                }
            ),
            "warnings": warnings,
        }
    )
