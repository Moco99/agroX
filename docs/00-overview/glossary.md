# Glosario

> TL;DR: Términos, IDs de módulos y enums canónicos. Si un doc usa otro nombre, gana este.
> Depende de: nada.
> Estado: draft
> Última revisión: 2026-11-14

## Módulos (IDs canónicos)

| ID (código) | Nombre | Qué es |
|---|---|---|
| `twin` | Digital Twin Engine | Núcleo: estado diario de parcela, sincronización con observaciones, simulación. |
| `earth_scanner` | Earth Scanner | Clima NASA e indicadores climáticos. |
| `digital_farm` | Digital Farm | Mapa 2D (Leaflet) + escena 3D ilustrativa (R3F). |
| `rotation` | Rotation Engine | Candidatos → restricciones → indicadores → ranking. |
| `what_if` | What If | Escenarios: lluvia, temperatura, pesos, ciclo, años análogos, Monte Carlo. |
| `copilot` | AI Copilot | Opcional. Redacta explicaciones de datos estructurados; nunca calcula. |
| `crop_catalog` | Crop Catalog | Base de conocimiento de cultivos versionada (`catalog_v1`). |
| `data_pipeline` | Data pipeline | `scraper/` (raw) → transformaciones → `derived/`. |

## Enums

| Enum | Valores | Uso |
|---|---|---|
| `DataState` | `MEASURED`, `DECLARED`, `ESTIMATED`, `SIMULATED`, `SYNTHETIC` | Etiqueta obligatoria de todo dato expuesto. |
| `TwinLevel` | `DIGITAL_MODEL`, `DIGITAL_SHADOW`, `DIGITAL_TWIN` | Nivel honesto de sincronización alcanzado. |
| `CropType` | `CASH_CROP`, `COVER_CROP` | Tipo en el catálogo. |
| `PhenoStage` | `PRE_PLANTING`, `INITIAL`, `DEVELOPMENT`, `MID_SEASON`, `LATE_SEASON`, `HARVESTED` | Etapas alineadas con Kc de FAO-56. |
| `RecommendationStatus` | `PRELIMINARY`, `VERIFIED_INPUTS` | Estado de una recomendación. |
| `IrrigationLevel` | `NONE`, `LOW`, `MEDIUM`, `HIGH` | **Propuesta.** Nivel de riego del escenario/zona (UI: Sin riego/Bajo/Medio/Alto); mm por nivel TBD. |

`DataState`:
- `MEASURED`: viene de un sensor/producto observacional (NASA POWER, MODIS, SMAP…). Nota: POWER es reanálisis/satélite por celda, no medición in situ; se etiqueta `MEASURED` con `source` explícito.
- `DECLARED`: lo dijo el usuario (cultivo previo, riego).
- `ESTIMATED`: derivado por un modelo de proceso a partir de datos reales (ET0, balance hídrico).
- `SIMULATED`: resultado de un escenario hipotético (What If, Monte Carlo).
- `SYNTHETIC`: generado artificialmente para prototipado. La UI **siempre** muestra aviso "datos sintéticos".

## Términos

| Término | Definición en AGROX |
|---|---|
| Parcela piloto | Polígono concreto dentro del bbox de Story County, Iowa (pendiente, ver [decisions](decisions.md)). |
| Zona / bbox | Rectángulo de ~10×10 km de `scraper/sources.json`. **No es una parcela.** |
| Granja (`farm_id`) | Parcela piloto vista como conjunto de zonas de manejo (propuesta, ver [data-contracts](../01-architecture/data-contracts.md)). |
| Zona de manejo (`zone_id`) | Subdivisión de la granja con un cultivo y suelo; cada una es una instancia del gemelo. En UI se dice "Zona Norte", etc.; en código siempre `zone`, nunca `bbox`. |
| Preset de escenario (`scenario_preset`) | Conjunto nombrado de parámetros What If (p. ej. `moderate_drought`); valores TBD. |
| Gemelo digital hídrico-fenológico | Estado diario + sincronización con observaciones + simulación. Ver [digital-twin-engine](../02-modules/digital-twin-engine.md). |
| Sombra digital | Modelo alimentado automáticamente con datos reales, sin observación independiente que lo contraste. |
| Discrepancia | Diferencia observado − simulado (p. ej. NDVI, humedad). Se muestra, no se oculta. |
| Nudging | Corrección parcial del estado hacia la observación (stretch). |
| Score (S) | Índice comparativo interno 0–100. **No es probabilidad de éxito.** |
| Indicadores A, Ssuelo, C | Compatibilidad hídrica, protección del suelo, compatibilidad climática (0–100). |
| Provider | Puerto de entrada de datos (`WeatherProvider`, `SoilProvider`, `CropCatalogProvider`, `ObservationProvider`). |
| Adaptador `Synthetic*` / `Real*` | Implementaciones del mismo puerto con datos falsos / reales. |
| raw / derived | Prefijos de almacenamiento: crudo inmutable / pequeño y consumible por la app. |
| HEAD | Rol de cabeza del proyecto (Fable). Ver [agent-routing](../06-agents/agent-routing.md). |
| Builder / Reviewer | Agente que construye / agente distinto que revisa. |

## IDs de cultivo (`crop_id`)

snake_case en inglés: `corn`, `soybean`, `cereal_rye` (o `oat`, decisión abierta). Futuro: `common_bean` (región Veracruz).

## Unidades canónicas

Temperatura °C · precipitación y ET mm/día · radiación MJ m⁻² día⁻¹ (convertir si la fuente da kWh) · viento m/s a 2 m · humedad del suelo m³/m³ · lámina en zona radicular mm · fechas ISO-8601 (`YYYY-MM-DD`) · coordenadas WGS84 (lat, lon).
