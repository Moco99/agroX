"""Rotation comparisons for a farm, using traceable climate and explicit assumptions."""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from math import isfinite
from statistics import mean
from typing import Any

from app.engine.ecocrop_model import RotationEngine
from app.engine.rotation import DEFAULT_ROTATION_WEIGHT, rank_rotations, rotation_quality, select_diverse
from app.providers.factory import Providers, weather_for
from app.schemas.common import DataState
from app.schemas.rotations import RotationRecommendRequest
from app.schemas.weather import WeatherDay
from app.services.errors import InvalidRequestError
from app.services.farm_load_service import ensure_supported


@lru_cache(maxsize=1)
def engine() -> RotationEngine:
    # Dataset and surrogate RF are immutable after fitting; reuse them across requests.
    return RotationEngine(enable_risk=False)


def search(query: str, limit: int) -> list[dict[str, Any]]:
    return engine().ecocrop.find_crops(query, limit)


def summarize_climate(
    days: list[WeatherDay],
    start: date,
    end: date,
    request: RotationRecommendRequest,
) -> dict[str, Any]:
    expected = (end - start).days + 1
    if len(days) != expected or any(
        day.date != start + timedelta(days=index) or not isfinite(day.t_mean) or not isfinite(day.precip)
        for index, day in enumerate(days)
    ):
        raise InvalidRequestError(
            f"Datos climáticos incompletos para {start} a {end}. "
            "Elige un periodo con temperatura y lluvia diarias disponibles."
        )
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": len(days),
        "t_mean": mean(day.t_mean for day in days) + request.scenario.temp_delta_c,
        "rain_mm": sum(day.precip for day in days) * request.scenario.precip_factor,
    }


def daily_series(
    days: list[WeatherDay], request: RotationRecommendRequest
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Daily temperature and rain with the hypothetical scenario applied (validated by summarize_climate)."""
    scenario = request.scenario
    return (
        tuple(day.t_mean + scenario.temp_delta_c for day in days),
        tuple(day.precip * scenario.precip_factor for day in days),
    )


def recommend(p: Providers, request: RotationRecommendRequest) -> dict[str, Any]:
    ensure_supported(p, request.farm_id)
    weather = weather_for(p, request.farm_id).get_daily(request.start, request.end)
    windows = request.cycle_windows
    if windows is None:
        reference = summarize_climate(weather.days, request.start, request.end, request)
        cycle_inputs = [reference] * request.cycles
        # One object reused for every cycle: the engine scores it once per crop
        series = [daily_series(weather.days, request)] * request.cycles
    else:
        per_window = [[day for day in weather.days if window.start <= day.date <= window.end] for window in windows]
        cycle_inputs = [
            summarize_climate(days, window.start, window.end, request)
            for days, window in zip(per_window, windows, strict=True)
        ]
        series = [daily_series(days, request) for days in per_window]
        included = [day for days in per_window for day in days]
        reference = {
            "start": windows[0].start.isoformat(),
            "end": windows[-1].end.isoformat(),
            "days": len(included),
            "t_mean": mean(day.t_mean for day in included) + request.scenario.temp_delta_c,
            "rain_mm": sum(day.precip for day in included) * request.scenario.precip_factor,
        }
    warnings = list(p.warnings) + list(weather.warnings)
    twin_crops = {crop.crop_id: crop for crop in p.catalog.get_catalog().crops}
    warnings.extend(
        [
            "Índice comparativo exploratorio, no probabilidad, rendimiento ni recomendación agronómica validada.",
            "Dentro de cada ventana se busca (por semanas) la temporada de duración EcoCrop del cultivo con mejor "
            "ajuste; la temperatura se juzga por el bloque de 30 días más limitante y la lluvia por el total de esa "
            "temporada. Si la ventana es más corta que el ciclo, la lluvia se extrapola a su tasa diaria.",
            "Los indicadores aproximan lluvia, pH y temperatura; no miden balance hídrico ni salud del suelo.",
            "Cada ciclo usa su propio periodo declarado."
            if windows
            else "El mismo clima de referencia se usa en todos los ciclos.",
            "El índice suma un componente de rotación (cambio de familia, leguminosa antes de no leguminosa, "
            "diversidad de familias) con pesos de producto documentados; no cuantifica rendimiento ni N en kg/ha.",
            "Se muestran alternativas con conjuntos de cultivos distintos antes que variantes casi iguales.",
            "En caso de empate, se priorizan menos repeticiones consecutivas de familia botánica.",
            "El modelo de riesgo se entrenó con datos sintéticos; su salida se omite de la recomendación.",
        ]
    )
    if not request.allow_consecutive_same_crop:
        warnings.append("Se excluye repetir el mismo cultivo en ciclos consecutivos (incluido el cultivo previo).")
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
    families = {crop["id"]: crop["family"] for crop in model.PRIMARY_CROPS}
    legumes = {crop["id"] for crop in model.PRIMARY_CROPS if crop["is_legume"]}
    try:
        all_recs = model.recommend_top_rotations(
            reference["t_mean"],
            reference["rain_mm"],
            soil_ph=ph,
            soil_awc=140,
            t_extreme_days=0,
            cycles=request.cycles,
            top_k=2401,
            previous_crop=request.previous_crop,
            exclude_same_family=request.exclude_same_family,
            allowed_crops=set(twin_crops) if request.twin_only else None,
            cycle_climates=[(item["t_mean"], item["rain_mm"]) for item in cycle_inputs] if windows else None,
            # EcoCrop rainfall is per crop cycle: the engine converts each window's rain to that length
            window_days=[item["days"] for item in cycle_inputs],
            start_crop=request.start_crop,
            cycle_series=series,
            exclude_same_crop=not request.allow_consecutive_same_crop,
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
        for cycle, climate in zip(safe_cycles, cycle_inputs, strict=True):
            cycle["window"] = {"start": climate["start"], "end": climate["end"]}
            season = cycle.pop("season", None)
            if season is not None:
                first = date.fromisoformat(climate["start"]) + timedelta(days=season["offset_days"])
                cycle["season"] = {
                    "start": first.isoformat(),
                    "end": (first + timedelta(days=season["days"] - 1)).isoformat(),
                    "days": season["days"],
                    "t_limiting_c": season["t_limiting_c"],
                }
            params = twin_crops.get(cycle["crop_id"])
            cycle["twin_supported"] = params is not None
            if windows is not None and params and climate["days"] < params.cycle_days:
                cycle["warnings"].append(
                    f"La ventana tiene {climate['days']} días y el catálogo estima "
                    f"{params.cycle_days} días para este cultivo."
                )
        enriched.append(
            {
                **rec,
                "cycles": safe_cycles,
                "indicators": indicators,
                "family_repeats": sum(cycle["same_family"] for cycle in cycles),
                "rotation": rotation_quality(rec["sequence"], families, legumes, request.previous_crop),
            }
        )
    if not enriched:
        warnings.append("No hay candidatos con umbrales EcoCrop completos para los indicadores solicitados.")
    rotation_weight = DEFAULT_ROTATION_WEIGHT if request.rotation_weight is None else request.rotation_weight
    ranked = rank_rotations(enriched, weights, rotation_weight)
    ranked.sort(key=lambda item: (-item["score"], item["family_repeats"]))
    shown = select_diverse(ranked, request.top_k)
    for item in shown:
        item["overall_score"] = round(item["score"], 1)
        item["status"] = "ÍNDICE COMPARATIVO"
        if request.soil_ph is None:
            item["indicators"]["soil"] = None
            for cycle in item["cycles"]:
                cycle["ph_fit"] = None
        item["explanation"] = explain(item)
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
        "methodology": "EcoCrop (bloque mensual más limitante) + componente de rotación: índice comparativo",
        "data_state": state,
        "inputs": {
            "farm_id": request.farm_id,
            **reference,
            "t_mean": round(reference["t_mean"], 2),
            "rain_mm": round(reference["rain_mm"], 2),
            "cycle_windows": cycle_inputs if windows else None,
            "twin_only": request.twin_only,
            "soil_ph": request.soil_ph,
            "climate_source": weather.provenance.source,
            "climate_data_state": weather.provenance.data_state.value,
            "scenario": request.scenario.model_dump(),
            "weights": request.weights.model_dump(),
            "rotation_weight": rotation_weight,
            "allow_consecutive_same_crop": request.allow_consecutive_same_crop,
        },
        "warnings": warnings,
        "recommendations": shown,
    }


def explain(item: dict[str, Any]) -> list[str]:
    """Plain-language score components for the UI (es-MX); the numbers are the ones returned in the item."""
    indicators, rotation = item["indicators"], item["rotation"]
    weight = item["rotation_weight"]
    soil = "no declarado" if indicators["soil"] is None else f"{indicators['soil']:.0f}"
    comps, counts = rotation["components"], rotation["counts"]
    lines = [
        f"Índice agroclimático {item['agroclimatic_score']:.0f}/100 (agua {indicators['water']:.0f}, "
        f"clima {indicators['climate']:.0f}, suelo {soil}), peso {1 - weight:.0%}.",
        f"Componente de rotación {rotation['index']:.0f}/100, peso {weight:.0%}: cambio de familia "
        f"{comps['family_break']:.0f}, leguminosa antes de no leguminosa {comps['legume_before_non_legume']:.0f}, "
        f"diversidad de familias {comps['family_diversity']:.0f} ({counts['families']} familia(s)).",
    ]
    if counts["same_crop"]:
        lines.append(f"Repite el mismo cultivo en {counts['same_crop']} de {counts['transitions']} transiciones.")
    if counts["same_family"]:
        lines.append(
            f"Repite familia botánica con otro cultivo en {counts['same_family']} de {counts['transitions']} "
            "transiciones."
        )
    if counts["legume_before_non_legume"]:
        lines.append(
            f"Una leguminosa precede a un cultivo no leguminoso en {counts['legume_before_non_legume']} de "
            f"{counts['transitions']} transiciones (aporte de N biológico, no cuantificado)."
        )
    for cycle in item["cycles"]:
        season = cycle.get("season")
        if season is not None and cycle["temperature_fit"] < 100:
            lines.append(
                f"Ciclo {cycle['cycle']} ({cycle['name']}): el bloque de 30 días más limitante promedia "
                f"{season['t_limiting_c']:.1f} °C (ajuste térmico {cycle['temperature_fit']:.0f})."
            )
    return lines
