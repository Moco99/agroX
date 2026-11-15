"""Pilot context from daily weather and observed farm NDVI, with explicit coverage."""

from __future__ import annotations

from datetime import date, timedelta
from statistics import mean

from app.providers.factory import Providers
from app.schemas.common import DataState
from app.schemas.region import NdviPoint, Period, RegionMetric, RegionSummary
from app.services.errors import InvalidRequestError


def summary(p: Providers, start: date, end: date) -> RegionSummary:
    if start > end or (end - start).days > 730:
        raise InvalidRequestError("Period must be ordered and at most 731 days")
    count = (end - start).days + 1
    prior_end = start - timedelta(days=1)
    prior_start = start - timedelta(days=count)
    coverage_start, coverage_end = p.weather.coverage()
    if end < coverage_start or prior_start > coverage_end:
        raise InvalidRequestError("Period is outside available weather coverage")
    weather = p.weather.get_daily(max(prior_start, coverage_start), min(end, coverage_end))
    series = p.observations.ndvi_series("story_pilot_farm", "modis_ndvi")
    by_date: dict[date, list[float]] = {}
    for point in series.points:
        if point.value is not None:
            by_date.setdefault(point.date, []).append(point.value)
    ndvi = {day: mean(values) for day, values in by_date.items()}
    current = [d for d in weather.days if start <= d.date <= end]
    previous = [d for d in weather.days if prior_start <= d.date <= prior_end]

    def metric(
        values: list[float], old: list[float], unit: str, source: str, state: DataState, total: bool = False
    ) -> RegionMetric:
        value = (sum(values) if total else mean(values)) if values else None
        before = (sum(old) if total else mean(old)) if old else None
        delta = value - before if value is not None and before is not None else None
        return RegionMetric(
            value=value,
            previous=before,
            delta=delta,
            delta_pct=100 * delta / abs(before) if delta is not None and before else None,
            unit=unit,
            source=source,
            data_state=state,
        )

    state = weather.provenance.data_state
    return RegionSummary(
        region_id="story_pilot",
        name="Story County, Iowa — contexto del piloto",
        bbox_wgs84=[-93.50214, 42.019447, -93.479167, 42.038454],
        period=Period(start=start, end=end, days=count),
        previous_period=Period(start=prior_start, end=prior_end, days=count),
        ndvi=metric(
            [v for d, v in ndvi.items() if start <= d <= end],
            [v for d, v in ndvi.items() if prior_start <= d <= prior_end],
            "index",
            series.provenance.source,
            series.provenance.data_state,
        ),
        precipitation=metric(
            [d.precip for d in current], [d.precip for d in previous], "mm", weather.provenance.source, state, True
        ),
        temperature=metric(
            [d.t_mean for d in current], [d.t_mean for d in previous], "°C", weather.provenance.source, state
        ),
        radiation=metric(
            [d.solar_rad for d in current],
            [d.solar_rad for d in previous],
            "MJ/m²/day",
            weather.provenance.source,
            state,
        ),
        ndvi_series=[NdviPoint(date=d, value=v) for d, v in sorted(ndvi.items()) if start <= d <= end],
        suitability=None,
        data_state=state,
        provenance=[weather.provenance, series.provenance],
        warnings=list(p.warnings)
        + list(weather.warnings)
        + ["NDVI summarizes available farm observations, not a whole-region spatial average."]
        + (
            ["Incomplete daily weather coverage; totals represent available days only."]
            if len(current) != count or len(previous) != count
            else []
        ),
    )
