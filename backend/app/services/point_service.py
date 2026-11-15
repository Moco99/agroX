"""Normalize independent source results without inventing missing measurements."""

from __future__ import annotations

import json
import math

from app.providers.points import query
from app.schemas.common import DataState
from app.schemas.points import PointQuery, PointResponse, PointSection

_SECTIONS = {
    "coverage": ("cobertura", "ESA WorldCover / Impact Observatory", DataState.ESTIMATED),
    "terrain": ("terreno", "Copernicus DEM 30 m", DataState.MEASURED),
    "soil": ("suelo", "ISRIC SoilGrids 250 m", DataState.ESTIMATED),
    "climate": ("clima", "NASA POWER historical daily data / climatology", DataState.ESTIMATED),
    "vegetation": ("vegetacion", "Sentinel-2 L2A 10 m", DataState.MEASURED),
    "suitability": ("aptitud", "FAO GAEZ v4, climate 1981–2010", DataState.ESTIMATED),
}


def run(request: PointQuery) -> PointResponse:
    assert request.start is not None and request.end is not None
    result = query(request.lat, request.lon, request.start.isoformat(), request.end.isoformat(), request.refresh)
    times = result.get("segundos")
    elapsed = times if isinstance(times, dict) else {}
    sections: dict[str, PointSection] = {}
    for name, (key, source, state) in _SECTIONS.items():
        raw = result.get(key)
        failure = not isinstance(raw, dict) or "error" in raw
        if not failure:
            try:
                json.dumps(raw, allow_nan=False)
            except (ValueError, TypeError):
                failure = True
        seconds = elapsed.get(key, 0)
        seconds = float(seconds) if isinstance(seconds, (float, int)) else 0.0
        seconds = seconds if math.isfinite(seconds) and seconds >= 0 else 0.0
        sections[name] = PointSection(
            status="error" if failure else "ok",
            data=None if failure else raw,
            error="Source unavailable; retry this historical query." if failure else None,
            source=source,
            data_state=state,
            elapsed_s=seconds,
        )
    return PointResponse.model_validate(
        {
            "point": {"lat": request.lat, "lon": request.lon},
            "period": {"start": request.start, "end": request.end},
            "sections": sections,
        }
    )
