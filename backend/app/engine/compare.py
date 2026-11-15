"""Observed vs simulated comparison (model 16 simplified): shape of NDVI vs expected canopy; SMAP anomalies.

The twin never simulates NDVI. We compare the *shape* (min-max normalised) of the
observed NDVI series with the expected canopy index derived from Kc/stage, and
report timing (green-up, peak) and correlation. SMAP (surface, 9 km) is compared as
standardised anomalies against the simulated root-zone water fraction: context only.
"""

from __future__ import annotations

import math
from datetime import date

from app.engine import phenology
from app.engine.config import KC_BARE_SOIL
from app.schemas.common import DataState
from app.schemas.crops import CropParams
from app.schemas.twin import ComparisonMetrics, Discrepancy, TwinState


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    return sxy / math.sqrt(sxx * syy)


def _normalise(values: list[float]) -> list[float]:
    lo, hi = min(values), max(values)
    if hi - lo <= 1e-9:
        return [0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def expected_canopy_series(states: list[TwinState], crop: CropParams) -> list[tuple[date, float]]:
    return [(s.date, phenology.canopy_index_for(s.stage, s.kc, crop, KC_BARE_SOIL)) for s in states]


def _first_crossing(series: list[tuple[date, float]], level: float) -> date | None:
    for d, v in series:
        if v >= level:
            return d
    return None


def compare_ndvi(
    states: list[TwinState],
    crop: CropParams,
    observed: list[tuple[date, float]],
    source_id: str,
    observed_state: DataState,
) -> tuple[list[Discrepancy], ComparisonMetrics]:
    """Align observations to simulated days and compare normalised shapes; timing from 50 % crossings."""
    by_date = {d: v for d, v in expected_canopy_series(states, crop)}
    pairs = [(d, v, by_date[d]) for d, v in sorted(observed) if d in by_date]
    canopy = expected_canopy_series(states, crop)
    note = "shape comparison only: expected canopy index is normalised Kc, not simulated NDVI"
    if len(pairs) < 2:
        return [], ComparisonMetrics(
            variable="ndvi_shape",
            source_id=source_id,
            n_points=len(pairs),
            correlation=None,
            mean_abs_delta=None,
            observed_peak_date=None,
            simulated_peak_date=None,
            lag_days=None,
            note=note + "; too few observations inside the simulated period",
            data_state=observed_state,
        )
    obs_norm = _normalise([p[1] for p in pairs])
    sim = [p[2] for p in pairs]
    discrepancies = [
        Discrepancy(
            date=p[0], variable="ndvi_shape", observed=round(o, 4), simulated=round(s, 4), delta=round(o - s, 4)
        )
        for p, o, s in zip(pairs, obs_norm, sim, strict=True)
    ]
    obs_peak = max(pairs, key=lambda p: p[1])[0]
    sim_peak_candidates = [d for d, v in canopy if v >= 0.999]
    sim_peak = sim_peak_candidates[0] if sim_peak_candidates else max(canopy, key=lambda t: t[1])[0]
    obs_greenup = _first_crossing([(p[0], o) for p, o in zip(pairs, obs_norm, strict=True)], 0.5)
    sim_greenup = _first_crossing(canopy, 0.5)
    # A green-up date only exists if the observations start before canopy closure; an end-of-season-only
    # series (e.g. the six Sentinel-2 scenes) would otherwise report its first point as "green-up"
    observed_before_greenup = sim_greenup is not None and pairs[0][0] < sim_greenup and obs_norm[0] < 0.5
    lag = (obs_greenup - sim_greenup).days if obs_greenup and sim_greenup and observed_before_greenup else None
    return discrepancies, ComparisonMetrics(
        variable="ndvi_shape",
        source_id=source_id,
        n_points=len(pairs),
        correlation=None if (c := _pearson(obs_norm, sim)) is None else round(c, 3),
        mean_abs_delta=round(sum(abs(d.delta) for d in discrepancies) / len(discrepancies), 4),
        observed_peak_date=obs_peak,
        simulated_peak_date=sim_peak,
        lag_days=lag,
        note=note
        + (
            "; lag_days = observed green-up (50 % of NDVI range) minus simulated 50 % canopy"
            if lag is not None
            else "; lag_days unavailable: observations do not cover green-up"
        ),
        data_state=observed_state,
    )


def compare_soil_moisture(
    states: list[TwinState], observed: list[tuple[date, float]], source_id: str, observed_state: DataState
) -> tuple[list[Discrepancy], ComparisonMetrics]:
    """Standardised anomalies of SMAP surface moisture vs simulated root-zone water fraction (context only)."""
    by_date = {s.date: s.soil_water_fraction for s in states}
    pairs = [(d, v, by_date[d]) for d, v in sorted(observed) if d in by_date]
    note = "SMAP is 9 km / ~5 cm surface: anomalies compared, absolute values are not comparable"
    if len(pairs) < 3:
        return [], ComparisonMetrics(
            variable="soil_moisture_anomaly",
            source_id=source_id,
            n_points=len(pairs),
            correlation=None,
            mean_abs_delta=None,
            observed_peak_date=None,
            simulated_peak_date=None,
            lag_days=None,
            note=note + "; too few observations",
            data_state=observed_state,
        )
    obs = [p[1] for p in pairs]
    sim = [p[2] for p in pairs]

    def z(values: list[float]) -> list[float]:
        m = sum(values) / len(values)
        sd = math.sqrt(sum((v - m) ** 2 for v in values) / len(values))
        return [0.0 for _ in values] if sd <= 1e-9 else [(v - m) / sd for v in values]

    zo, zs = z(obs), z(sim)
    discrepancies = [
        Discrepancy(
            date=p[0],
            variable="soil_moisture_anomaly",
            observed=round(o, 3),
            simulated=round(s, 3),
            delta=round(o - s, 3),
        )
        for p, o, s in zip(pairs, zo, zs, strict=True)
    ]
    return discrepancies, ComparisonMetrics(
        variable="soil_moisture_anomaly",
        source_id=source_id,
        n_points=len(pairs),
        correlation=None if (c := _pearson(zo, zs)) is None else round(c, 3),
        mean_abs_delta=round(sum(abs(d.delta) for d in discrepancies) / len(discrepancies), 3),
        observed_peak_date=max(pairs, key=lambda p: p[1])[0],
        simulated_peak_date=max(pairs, key=lambda p: p[2])[0],
        lag_days=None,
        note=note,
        data_state=observed_state,
    )
