"""Observed coverage and explicit historical analogue weather for simulations."""

from __future__ import annotations

from datetime import date, timedelta

from app.engine.config import REFERENCE_MAX_FILL_DAYS
from app.providers.ports import WeatherProvider
from app.schemas.common import DataState
from app.schemas.weather import WeatherDay, WeatherSeries
from app.services.errors import InvalidRequestError

# qa flag set on every reference day that was filled from its neighbours instead of observed
FILLED_FLAG = "reference_gap_filled"

# ─────────────────────────────────────────
# Section: Coverage
# ─────────────────────────────────────────


def _gaps(available: set[date], start: date, end: date) -> list[tuple[date, date]]:
    """Runs of consecutive missing days inside start..end."""
    out: list[tuple[date, date]] = []
    current = start
    while current <= end:
        if current in available:
            current += timedelta(days=1)
            continue
        first = current
        while current <= end and current not in available:
            current += timedelta(days=1)
        out.append((first, current - timedelta(days=1)))
    return out


def _complete_years(start: date, end: date, gaps: list[tuple[date, date]]) -> list[int]:
    """Calendar years fully inside coverage whose gaps are all short enough to be filled."""
    years: list[int] = []
    for year in range(start.year, end.year + 1):
        if date(year, 1, 1) < start or date(year, 12, 31) > end:
            continue
        in_year = [(a, b) for a, b in gaps if a.year <= year <= b.year]
        if all((b - a).days + 1 <= REFERENCE_MAX_FILL_DAYS for a, b in in_year):
            years.append(year)
    return years


def observed_coverage(provider: WeatherProvider) -> dict[str, object]:
    start, end = provider.coverage()
    series = provider.get_daily(start, end)
    available = {day.date for day in series.days}
    gaps = _gaps(available, start, end)
    complete = _complete_years(start, end, gaps)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "missing": [{"start": a.isoformat(), "end": b.isoformat()} for a, b in gaps],
        "available_days": len(available),
        # Usable reference years: complete calendar years; a later partial year also works (see analogue_weather)
        "complete_years": complete,
        "latest_complete_year": complete[-1] if complete else None,
        "max_filled_gap_days": REFERENCE_MAX_FILL_DAYS,
        "source": series.provenance.source,
        "data_state": series.provenance.data_state.value,
        "warnings": series.warnings,
    }


# ─────────────────────────────────────────
# Section: Historical analogue
# ─────────────────────────────────────────


def _same_day(day: date, year: int) -> tuple[date, bool]:
    """`day` moved to `year`; 29 February becomes 28 February in non-leap years (flag = adjusted)."""
    try:
        return day.replace(year=year), False
    except ValueError as exc:
        if day.month != 2 or day.day != 29:
            raise InvalidRequestError("Año de referencia fuera de rango") from exc
        return date(year, 2, 28), True


def _between(before: WeatherDay | None, after: WeatherDay | None, day: date) -> WeatherDay:
    """Linear interpolation between the neighbours of a short gap (copy of the only one at an edge)."""
    if before is None or after is None:
        only = before or after
        assert only is not None
        return only.model_copy(update={"date": day, "qa_flags": [FILLED_FLAG]})
    w = (day - before.date).days / (after.date - before.date).days

    def mix(a: float | None, b: float | None) -> float | None:
        return None if a is None or b is None else a + (b - a) * w

    fields = ("t_mean", "t_max", "t_min", "precip", "rh_mean", "solar_rad", "wind_2m", "gwet_root", "gwet_top")
    values = {f: mix(getattr(before, f), getattr(after, f)) for f in fields}
    return before.model_copy(update={"date": day, "qa_flags": [FILLED_FLAG], **values})


def _suggestion(provider: WeatherProvider) -> str:
    latest = observed_coverage(provider)["latest_complete_year"]
    return f", por ejemplo {latest} (último año completo)" if latest else ""


def analogue_weather(
    provider: WeatherProvider, start: date, end: date, reference_year: int, target_anchor_year: int | None = None
) -> WeatherSeries:
    """Map reference-year daily observations to target dates.

    Days after the last observation use the same date one year earlier; gaps of up to REFERENCE_MAX_FILL_DAYS
    are interpolated and flagged; longer gaps reject the reference year. Every adjustment is a warning.
    """
    anchor = start.year if target_anchor_year is None else target_anchor_year
    cov_start, cov_end = provider.coverage()
    if reference_year > cov_end.year:
        raise InvalidRequestError(
            f"El año de referencia {reference_year} aún no tiene observaciones (último dato: {cov_end.isoformat()}). "
            f"Elige otro año{_suggestion(provider)}."
        )
    pairs: list[tuple[date, date]] = []
    wrapped: list[date] = []
    leap_adjusted = False
    target = start
    while target <= end:
        reference, adjusted = _same_day(target, reference_year + target.year - anchor)
        # The reference has not happened yet (current year): reuse the same date of the previous year
        while reference > cov_end:
            reference, again = _same_day(reference, reference.year - 1)
            adjusted = adjusted or again
            if not wrapped or wrapped[-1] != target:
                wrapped.append(target)
        leap_adjusted = leap_adjusted or adjusted
        pairs.append((target, reference))
        target += timedelta(days=1)
    if not pairs:
        raise InvalidRequestError("El periodo debe estar ordenado")
    first_ref = min(ref for _, ref in pairs)
    last_ref = max(ref for _, ref in pairs)
    pad = timedelta(days=REFERENCE_MAX_FILL_DAYS + 1)
    lo = min(first_ref, max(cov_start, first_ref - pad))
    hi = max(last_ref, min(cov_end, last_ref + pad))
    source = provider.get_daily(lo, hi)
    lookup = {day.date: day for day in source.days}

    filled: list[date] = []
    needed = {ref for _, ref in pairs}
    for gap_start, gap_end in _gaps(set(lookup), lo, hi):
        if not any(gap_start <= ref <= gap_end for ref in needed):
            continue
        length = (gap_end - gap_start).days + 1
        before = lookup.get(gap_start - timedelta(days=1))
        after = lookup.get(gap_end + timedelta(days=1))
        if length > REFERENCE_MAX_FILL_DAYS or (before is None and after is None):
            first_missing = min(ref for ref in needed if gap_start <= ref <= gap_end)
            raise InvalidRequestError(
                f"El año de referencia {reference_year} no tiene datos para {first_missing.isoformat()} "
                f"({length} día(s) seguidos sin observación; solo se rellenan huecos de hasta "
                f"{REFERENCE_MAX_FILL_DAYS} días). Elige otro año{_suggestion(provider)}."
            )
        day = gap_start
        while day <= gap_end:
            lookup[day] = _between(before, after, day)
            filled.append(day)
            day += timedelta(days=1)

    state = DataState.SYNTHETIC if source.provenance.data_state == DataState.SYNTHETIC else DataState.SIMULATED
    warnings = list(source.warnings)
    warnings.append(
        f"Clima histórico de referencia {reference_year}, trasladado por mes y día: simulación, no pronóstico."
    )
    if wrapped:
        warnings.append(
            f"{len(wrapped)} día(s) del periodo ({wrapped[0].isoformat()} a {wrapped[-1].isoformat()}) caerían "
            f"después del último dato observado ({cov_end.isoformat()}); usan las mismas fechas del año anterior."
        )
    if filled:
        warnings.append(
            "Días sin dato en el clima de referencia, rellenados entre sus días vecinos y marcados "
            f"({FILLED_FLAG}): {', '.join(d.isoformat() for d in filled)}."
        )
    if leap_adjusted:
        warnings.append("El 29 de febrero se representa con el 28 de febrero del año histórico.")
    return source.model_copy(
        update={
            "days": [lookup[ref].model_copy(update={"date": dest}) for dest, ref in pairs],
            "provenance": source.provenance.model_copy(
                update={
                    "data_state": state,
                    "method": f"Historical analogue from {reference_year}; calendar dates mapped to simulation window"
                    + ("; short gaps interpolated" if filled else "")
                    + ("; days after coverage end use the previous year" if wrapped else "")
                    + ".",
                }
            ),
            "warnings": warnings,
        }
    )
