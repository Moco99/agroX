# Earth Scanner (`earth_scanner`)

> TL;DR: Expone clima diario (NASA POWER) e indicadores climáticos de la parcela (acumulados, anomalías, umbrales, SPI) y alimenta las pantallas S1 (región, stretch) y S2 (parcela con NDVI).
> Depende de: [data-contracts](../01-architecture/data-contracts.md)
> Estado: draft
> Última revisión: 2026-11-14

## Responsabilidad

- Entregar `WeatherSeries` (vía `WeatherProvider`) e indicadores derivados para un periodo.
- Endpoint: `GET /api/climate` ([data-contracts](../01-architecture/data-contracts.md)).
- Pantallas: S1 y S2 de [ui-spec](../07-design/ui-spec.md) (vista 2 del dossier: indicadores NASA y gráficas Recharts).

## Indicadores

| Indicador | Modelo | Requiere historia larga | MVP |
|---|---|---|---|
| Precipitación acumulada (mes / ciclo) | — | No | Sí |
| Temperatura media del periodo | — | No | Sí |
| Días bajo/sobre umbral térmico | 10 | No | Sí (umbrales TBD por cultivo, del catálogo) |
| GDD acumulados | 5 | No | Sí |
| ET0 diaria / acumulada | 1, 2 | No | Sí |
| Anomalía % de precipitación | 8 | **Sí** (climatología) | Con sintético multi-año; real tras O-7 |
| SPI / SPEI | 9 | **Sí** (≥ ~30 años recomendado) | Stretch con real |

Fórmulas: [model-specs](../03-models/model-specs.md). Dónde/por qué: [models-catalog](../03-models/models-catalog.md).

## Reglas

- La anomalía de precipitación **no** equivale por sí sola a un diagnóstico de sequía (texto del dossier; mostrarlo como nota).
- POWER describe celdas espaciales, no la parcela metro a metro: mostrar `source` y resolución.
- Si la climatología es corta (2023–2024), el indicador se marca con `warnings: ["short climatology"]` y no se calcula SPI.
- Radiación: confirmar unidades antes de usar (O-6 en [decisions](../00-overview/decisions.md)).

## Resiliencia (dossier)

La demo usa una serie descargada y versionada (`derived/weather/`). Si se muestra, se dice "serie descargada el <fecha>", nunca se disfraza de consulta en vivo.

## Pantallas S1 y S2 (UI)

| Bloque | Dato | Regla |
|---|---|---|
| S1 panel "Análisis de región" (stretch) | `GET /api/climate` sobre el bbox | Deltas solo con referencia explícita ("vs. período anterior" / "vs. climatología <años>"); si climatología corta → `warnings` |
| S2 stepper 1 Ubicación → 2 Granja → 3 Análisis | 1: parcela piloto (sin geocoding en MVP); 2: contexto `DECLARED` (cultivo actual/previo, riego, siembra) + zonas; 3: `POST /api/farms/analyze` | Paso 3 deshabilitado hasta completar 1–2 |
| S2 "Condiciones recientes (30 días)" | media/acumulado de `WeatherSeries` en la ventana | Precipitación = acumulado (mm), no media; radiación en MJ m⁻² día⁻¹ (O-6) |
| S2 overlay NDVI | `GET /api/observations/ndvi-overlay` → PNG + `bounds` sobre Leaflet ([digital-farm-3d](digital-farm-3d.md)) | Backend recorta y colorea con la rampa de [design-tokens](../07-design/design-tokens.md); leyenda con fuente, resolución y fecha |
| S2 "Evolución del NDVI" | `GET /api/observations/ndvi` | MODIS 250 m como serie segura; Sentinel-2 solo tras arreglar deuda (a) de [data-pipeline](data-pipeline.md) |
| S2 "Análisis de la parcela" | `POST /api/copilot/explain` (template) | Solo cifras presentes en la entrada; afirmaciones de área ("~12 % del área") solo si el backend las calcula |

Overlay renderizado en backend (no en el navegador) porque el ráster recortado ya vive en `pipeline/`/`derived/` y así el frontend no carga GeoTIFF ni librerías de ráster.

## Implementación

- `engine/climate/indicators.py`: funciones puras sobre `pandas.DataFrame` indexado por fecha.
- `services/climate_service.py`: obtiene serie del provider, llama indicadores, arma respuesta con provenance.
- `pipeline/build_ndvi.py` (+ `services/observation_service.py`): recorte y PNG del overlay.
- Builder: Sonnet para cableado y UI; Opus para SPI, anomalías y QA del overlay (ver [agent-routing](../06-agents/agent-routing.md)).
