"""Rotation comparisons for a farm, using traceable climate and explicit assumptions."""

from __future__ import annotations

from functools import lru_cache
from statistics import mean
from typing import Any

from app.engine.ecocrop_model import RotationEngine
from app.engine.rotation import rank_rotations
from app.providers.factory import Providers, weather_for
from app.schemas.common import DataState
from app.schemas.rotations import RotationRecommendRequest
from app.services.errors import InvalidRequestError
from app.services.farm_load_service import ensure_supported


@lru_cache(maxsize=1)
def engine() -> RotationEngine:
    # Dataset and surrogate RF are immutable after fitting; reuse them across requests.
    return RotationEngine(enable_risk=False)


def search(query: str, limit: int) -> list[dict[str, Any]]:
    return engine().ecocrop.find_crops(query, limit)


def recommend(p: Providers, request: RotationRecommendRequest) -> dict[str, Any]:
    ensure_supported(p, request.farm_id)
    weather = weather_for(p, request.farm_id).get_daily(request.start, request.end)
    if not weather.days:
        raise InvalidRequestError("No hay datos climáticos para el periodo seleccionado")
    temp = mean(day.t_mean for day in weather.days) + request.scenario.temp_delta_c
    rain = sum(day.precip for day in weather.days) * request.scenario.precip_factor
    warnings = list(p.warnings) + list(weather.warnings)
    actual_start, actual_end = weather.days[0].date, weather.days[-1].date
    if (
        actual_start != request.start
        or actual_end != request.end
        or len(weather.days) != (request.end - request.start).days + 1
    ):
        warnings.append("Periodo climático incompleto: se utilizan únicamente los días disponibles.")
    warnings.extend(
        [
            "Índice comparativo exploratorio, no probabilidad, rendimiento ni recomendación agronómica validada.",
            "La precipitación del periodo se compara con umbrales EcoCrop cuya escala temporal requiere verificación.",
            "Los indicadores aproximan lluvia, pH y temperatura; no miden balance hídrico ni salud del suelo.",
            "El clima se aplica a todos los ciclos; el catálogo contiene siete cultivos candidatos.",
            "El modelo de riesgo se entrenó con datos sintéticos; su salida se omite de la recomendación.",
            "El historial restringe familias solo si se solicita; los bonos heurísticos no afectan el ranking.",
        ]
    )
    if request.soil_ph is None:
        warnings.append(
            "pH no declarado: se excluye el suelo del ranking; se usa 6.5 solo en cálculos auxiliares internos."
        )
    ph = request.soil_ph if request.soil_ph is not None else 6.5
    weights = request.weights.model_dump()
    if request.soil_ph is None:
        weights["soil"] = 0.0
    if weights["water"] + weights["climate"] + weights["soil"] <= 0:
        raise InvalidRequestError("Declara el pH o asigna peso positivo a agua o clima")
    model = engine()
    try:
        all_recs = model.recommend_top_rotations(
            temp,
            rain,
            soil_ph=ph,
            soil_awc=140,
            t_extreme_days=0,
            cycles=request.cycles,
            top_k=2401,
            previous_crop=request.previous_crop,
            exclude_same_family=request.exclude_same_family,
        )
    except ValueError as exc:
        raise InvalidRequestError(str(exc)) from exc
    enriched = []
    for rec in all_recs:
        cycles = rec["cycles"]
        # Any missing required EcoCrop threshold produces a neutral fallback in the underlying
        # model. Do not rank candidates using such values as if they were measured.
        required = ("temperature", "rain") + (("pH",) if request.soil_ph is not None else ())
        if any(
            any(f"Missing {dimension} " in warning for dimension in required)
            for cycle in cycles
            for warning in cycle["warnings"]
        ):
            continue
        indicators = {
            "water": mean(c["rainfall_fit"] for c in cycles),
            "climate": mean(c["temperature_fit"] for c in cycles),
            "soil": mean(c["ph_fit"] for c in cycles) if request.soil_ph is not None else 0.0,
        }
        # The synthetic surrogate is not a validated field-risk model.
        safe_cycles = [
            {
                k: v
                for k, v in c.items()
                if k not in {"risk_level", "key_risk_factor", "score", "ecocrop_suitability", "dimension_warnings"}
            }
            for c in cycles
        ]
        enriched.append({**rec, "cycles": safe_cycles, "indicators": indicators})
    if not enriched:
        warnings.append("No hay candidatos con umbrales EcoCrop completos para los indicadores solicitados.")
    ranked = rank_rotations(enriched, weights)
    for item in ranked:
        item["overall_score"] = round(item["score"], 1)
        item["status"] = "ÍNDICE COMPARATIVO"
        if request.soil_ph is None:
            item["indicators"]["soil"] = None
            for cycle in item["cycles"]:
                cycle["ph_fit"] = None
    simulated = request.scenario.temp_delta_c != 0 or request.scenario.precip_factor != 1
    state = (
        "SYNTHETIC"
        if weather.provenance.data_state == DataState.SYNTHETIC
        else "SIMULATED"
        if simulated
        else "ESTIMATED"
    )
    return {
        "status": "ok",
        "methodology": "EcoCrop: índices comparativos de temperatura, lluvia y pH",
        "data_state": state,
        "inputs": {
            "farm_id": request.farm_id,
            "start": actual_start.isoformat(),
            "end": actual_end.isoformat(),
            "days": len(weather.days),
            "t_mean": round(temp, 2),
            "rain_mm": round(rain, 2),
            "soil_ph": request.soil_ph,
            "climate_source": weather.provenance.source,
            "climate_data_state": weather.provenance.data_state.value,
            "scenario": request.scenario.model_dump(),
            "weights": request.weights.model_dump(),
        },
        "warnings": warnings,
        "recommendations": ranked[: request.top_k],
    }
