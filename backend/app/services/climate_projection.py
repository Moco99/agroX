"""Opt-in future climate from CMIP6 projections: request validation, parallel fetch of several models, choice of
the run the UI animates and the across-model range of the season outcome (ADR-024)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date

from app.providers.factory import Providers
from app.providers.live.projection import (
    DAILY_MODELS,
    FIRST_DAY,
    LAST_DAY,
    PROJECTION_SOURCE,
    WIND_10M_TO_2M,
    ProjectionNoDataError,
)
from app.providers.ports import UpstreamUnavailableError
from app.schemas.twin import (
    ClimateProjectionInfo,
    ModelSeasonOutcome,
    ProjectionRange,
    ProjectionRequest,
    TwinSimulateRequest,
)
from app.schemas.weather import WeatherSeries
from app.services.errors import InvalidRequestError

SCENARIO_LABELS = {
    "ssp126": "emisiones bajas (SSP1-2.6)",
    "ssp245": "emisiones medias (SSP2-4.5)",
    "ssp370": "emisiones altas (SSP3-7.0)",
}
ANIMATED_RULE = (
    "Se anima el modelo con la lluvia mediana del periodo entre los modelos que respondieron "
    "(con número par, el menor de los dos centrales)."
)
VARIABLES = [
    "T2M, T2M_MAX, T2M_MIN: temperatura a 2 m (°C)",
    "PRECTOTCORR: precipitación (mm/día)",
    "RH2M: humedad relativa a 2 m (%)",
    "ALLSKY_SFC_SW_DWN: radiación solar en superficie",
    "WS10M: viento a 10 m (m/s)",
]
NO_DATA = (
    "La API de proyecciones climáticas de NASA POWER (beta) no tiene datos para este punto: en las pruebas "
    "del 15 de noviembre de 2026 solo respondió en tierra firme de Norteamérica (aprox. al norte de 18.6° N). "
    "Usa el año histórico de referencia."
)
UNAVAILABLE = (
    "La API de proyecciones climáticas de NASA POWER (beta) no respondió para este punto. "
    "Reintenta en unos minutos o usa el año histórico de referencia."
)


@dataclass(frozen=True)
class ProjectionRun:
    series: dict[str, WeatherSeries]
    animated: str
    info: ClimateProjectionInfo
    warnings: list[str]


# ─────────────────────────────────────────
# Section: Validation (all 422)
# ─────────────────────────────────────────


def wants_projection(req: TwinSimulateRequest) -> bool:
    """Validates the optional climate_source fields; True only for an explicit projection request."""
    if req.climate_source is None:
        if req.projection is not None:
            raise InvalidRequestError("projection requiere climate_source='projection'.")
        return False
    if req.climate_source == "reference_year":
        if req.projection is not None:
            raise InvalidRequestError("climate_source='reference_year' no admite el bloque projection.")
        if req.reference_year is None:
            raise InvalidRequestError("climate_source='reference_year' requiere reference_year.")
        return False
    if req.reference_year is not None:
        raise InvalidRequestError(
            "Elige una sola fuente de clima: año histórico de referencia o proyección climática, no ambas."
        )
    if req.projection is None:
        raise InvalidRequestError("climate_source='projection' requiere projection.scenario (ssp126, ssp245, ssp370).")
    model = req.projection.model
    if model == "ensemble":
        raise InvalidRequestError(
            "El promedio 'ensemble' de modelos no sirve para el balance hídrico: suaviza la lluvia diaria y "
            "elimina los días secos. Elige un modelo individual o deja model vacío."
        )
    if model is not None and model not in DAILY_MODELS:
        raise InvalidRequestError(
            f"Modelo '{model}' no disponible a escala diaria; usa uno de: {', '.join(DAILY_MODELS)}."
        )
    return True


def check_window(start: date, end: date) -> None:
    if start < FIRST_DAY or end > LAST_DAY:
        raise InvalidRequestError(
            f"Las proyecciones CMIP6 cubren del {FIRST_DAY.isoformat()} al {LAST_DAY.isoformat()}; "
            f"el periodo {start.isoformat()} a {end.isoformat()} queda fuera."
        )


# ─────────────────────────────────────────
# Section: Fetch every model and choose the animated run
# ─────────────────────────────────────────


def _ranges(gaps: list[tuple[date, date]]) -> list[str]:
    return [a.isoformat() if a == b else f"{a.isoformat()}..{b.isoformat()}" for a, b in gaps]


def projected_weather(
    p: Providers, lat: float, lon: float, choice: ProjectionRequest, run_start: date, start: date, end: date
) -> ProjectionRun:
    if p.projection is None:
        raise InvalidRequestError("Las proyecciones climáticas necesitan datos reales (AGROX_DATA_MODE=real o live).")
    provider = p.projection
    models = [choice.model] if choice.model else list(DAILY_MODELS)

    def one(model: str) -> tuple[str, WeatherSeries | None, list[tuple[date, date]], bool, str | None]:
        try:
            series, gaps, in_w_m2 = provider.series(lat, lon, model, choice.scenario, run_start, end)
            return model, series, gaps, in_w_m2, None
        except Exception as exc:
            return model, None, [], False, f"{type(exc).__name__}: {str(exc)[:160]}"

    with ThreadPoolExecutor(max_workers=len(models)) as pool:
        results = list(pool.map(one, models))
    series = {m: s for m, s, _, _, err in results if s is not None and err is None}
    failed = {m: err for m, s, _, _, err in results if err is not None}
    if not series and all(err.startswith(ProjectionNoDataError.__name__) for err in failed.values()):
        raise InvalidRequestError(NO_DATA)
    if not series:
        raise UpstreamUnavailableError(f"{UNAVAILABLE} ({next(iter(failed.values()), '')})")
    gaps = {m: g for m, s, g, _, _ in results if s is not None and g}
    in_w_m2 = any(w for m, s, _, w, _ in results if s is not None)

    def season_rain(model: str) -> float:
        return sum(d.precip for d in series[model].days if start <= d.date <= end)

    ranked = sorted(series, key=lambda m: (season_rain(m), m))
    animated = ranked[(len(ranked) - 1) // 2]
    label = SCENARIO_LABELS[choice.scenario]
    rad = (
        "Radiación: la API la etiqueta MJ/m²/día pero entrega W/m²; se multiplica por 0.0864 → MJ/m²/día."
        if in_w_m2
        else "Radiación: valores ya en MJ/m²/día, sin conversión."
    )
    conversions = [
        rad,
        f"Viento: de 10 m a 2 m con FAO-56 ec. 47 (× {WIND_10M_TO_2M:.3f}).",
        "Humedad relativa acotada a 0–100 % y precipitación negativa a 0.",
    ]
    filled_days = {m: _ranges(g) for m, g in gaps.items()}
    warnings = [
        f"Clima proyectado CMIP6 ({label}): cada modelo es un futuro posible, no un pronóstico. "
        f"La animación usa {animated}; el resultado muestra el rango entre {len(series)} modelo(s).",
        "No se compara esta simulación con observaciones. El último NDVI conserva su fecha real.",
    ]
    if len(series) == 1:
        warnings.append(f"Solo se usó un modelo climático ({animated}): no hay rango de incertidumbre entre modelos.")
    if failed:
        warnings.append(f"Respondieron {len(series)} de {len(models)} modelos; sin datos: {', '.join(sorted(failed))}.")
    if gaps:
        n = len({d for g in gaps.values() for a, b in g for d in _days(a, b)})
        warnings.append(
            f"La API no trae {n} día(s) del periodo (fin de diciembre y/o 29 de febrero según el modelo); se "
            "rellenaron con los días vecinos del mismo modelo y quedan marcados (projection_gap_filled)."
        )
    if in_w_m2:
        warnings.append(
            "La radiación de NEX-GDDP-CMIP6 resultó mayor que la histórica de NASA POWER en los puntos revisados; "
            "la ET0 de esta simulación puede estar sobrestimada."
        )
    info = ClimateProjectionInfo(
        source=PROJECTION_SOURCE,
        scenario=choice.scenario,
        models_requested=models,
        models_used=sorted(series),
        models_failed=failed,
        animated_model=animated,
        animated_rule=ANIMATED_RULE,
        variables=VARIABLES,
        conversions=conversions,
        filled_days=filled_days,
        api_first_day=FIRST_DAY,
        api_last_day=LAST_DAY,
    )
    return ProjectionRun(series=series, animated=animated, info=info, warnings=warnings)


def _days(a: date, b: date) -> list[date]:
    return [date.fromordinal(o) for o in range(a.toordinal(), b.toordinal() + 1)]


def season_range(rows: list[ModelSeasonOutcome]) -> ProjectionRange:
    return ProjectionRange(
        n_models=len(rows),
        matured_models=sum(r.status == "COMPLETED" for r in rows),
        stress_days_min=min(r.stress_days for r in rows),
        stress_days_max=max(r.stress_days for r in rows),
        season_precip_min_mm=round(min(r.season_precip_mm for r in rows), 1),
        season_precip_max_mm=round(max(r.season_precip_mm for r in rows), 1),
        by_model=rows,
    )
