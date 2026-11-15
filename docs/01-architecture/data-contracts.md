# Contratos de datos y API

> TL;DR: Único dueño del contrato: endpoints, modelos Pydantic base, provenance y reglas. Synthetic* y Real* devuelven exactamente estos modelos.
> Depende de: [glossary](../00-overview/glossary.md)
> Estado: draft (endpoints `/api/twin/*`, `/api/observations/*`, `/api/farms/*` y modelo por zonas = PROPUESTA implementada en `feat/virtual-twin`)
> Última revisión: 2026-11-14

## Endpoints

| Método | Ruta | Respuesta | Origen |
|---|---|---|---|
| GET | `/api/health` | estado del servicio + `data_mode` | dossier |
| GET | `/api/climate?lat&lon&start&end` | serie diaria + indicadores | dossier |
| GET | `/api/crops` | catálogo versionado | dossier |
| POST | `/api/farms/analyze` | contexto de parcela | dossier |
| POST | `/api/rotations/recommend` | ranking + desglose | dossier |
| POST | `/api/scenarios/simulate` | ranking bajo escenario | dossier |
| POST | `/api/copilot/explain` | texto explicativo (opcional) | dossier |
| GET | `/api/farms` · `/api/farms/{farm_id}` | ids de granjas · igual que `analyze` | **PROPUESTA (implementada)** |
| GET | `/api/twin/config` | supuestos de producto: riego por nivel, presets, umbrales de estrés, siembras ([decisions](../00-overview/decisions.md) ADR-018) | **PROPUESTA (implementada)** |
| GET | `/api/twin/state?farm_id&date` | `TwinStateResponse`: snapshot por zona (`TwinState` + clase de estrés + NDVI observado ≤ fecha) | **PROPUESTA (implementada)** |
| POST | `/api/twin/simulate` | `TwinSimulateResponse`: por zona `states`, `summary`, `comparison`, `discrepancies`, `expected_canopy`, `monte_carlo` opcional | **PROPUESTA (implementada)** |
| GET | `/api/twin/observed-vs-simulated?farm_id&year` | misma respuesta, línea base abr–oct con comparación | **PROPUESTA (implementada)** |
| GET | `/api/observations/ndvi?farm_id&source=modis_ndvi\|sentinel2&start&end` | `ObservationSeries` NDVI por zona | **PROPUESTA (implementada)** |
| GET | `/api/observations/ndvi-overlay?farm_id` | PNG base64 coloreado (escala de [design-tokens](../07-design/design-tokens.md)) + `bounds` + `resolution_m` + `source` | **PROPUESTA (implementada)** |
| GET | `/api/observations/soil-moisture?farm_id&start&end` | `ObservationSeries` SMAP (contexto 9 km) | **PROPUESTA (implementada)** |

Implementados en esta rama: `/api/health`, `/api/crops`, `/api/climate?start&end[&lat&lon]` (lat/lon solo para avisar si se pide fuera del piloto), `/api/farms/analyze` y todos los de la tabla marcados "implementada". Pendientes: `/api/rotations/recommend`, `/api/scenarios/simulate`, `/api/copilot/explain` (la explicación es por plantillas en el frontend). Errores: 404 = granja/zona/fuente inexistente; 422 = parámetros fuera de rango, preset desconocido, periodo fuera de cobertura o que cruza años.

Fechas en query: `YYYY-MM-DD` (el dossier usaba `YYYYMMDD`; se normaliza a ISO).

## Reglas de contrato

- Documentar coordenadas, periodo, unidad, fuente y fecha de consulta (`Provenance`).
- Rechazar parámetros fuera de rango (422) y normalizar pesos para que sumen 1.
- Incluir `warnings` por datos faltantes o reglas no satisfechas.
- Separar `MEASURED` / `DECLARED` / `ESTIMATED` / `SIMULATED` / `SYNTHETIC` en cada valor expuesto.
- JSON en snake_case. Unidades canónicas de [glossary](../00-overview/glossary.md).

## Modelos base (`backend/app/schemas/common.py`)

```python
from datetime import date
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class DataState(str, Enum):
    MEASURED = "MEASURED"
    DECLARED = "DECLARED"
    ESTIMATED = "ESTIMATED"
    SIMULATED = "SIMULATED"
    SYNTHETIC = "SYNTHETIC"


class Provenance(BaseModel):
    source: str = Field(description="e.g. 'NASA POWER', 'synthetic:weather_v1'")
    data_state: DataState
    retrieved_at: date | None = None
    version: str | None = None


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Weights(BaseModel):
    water: float = Field(ge=0)
    soil: float = Field(ge=0)
    climate: float = Field(ge=0)

    # Users send any non-negative mix; the engine always works with weights summing to 1
    @model_validator(mode="after")
    def normalize(self) -> "Weights":
        total = self.water + self.soil + self.climate
        if total <= 0:
            raise ValueError("at least one weight must be positive")
        self.water, self.soil, self.climate = (self.water / total, self.soil / total, self.climate / total)
        return self
```

## Modelos de dominio (resumen; campos obligatorios)

| Modelo | Campos clave | Unidades |
|---|---|---|
| `WeatherDay` | `date, t_mean, t_max, t_min, precip, rh_mean, solar_rad, wind_2m` | °C, mm/día, %, MJ m⁻² día⁻¹, m/s |
| `WeatherSeries` | `location, days: list[WeatherDay], provenance` | |
| `SoilProfile` | `awc_mm_per_m, root_depth_max_m, texture, drainage_class, provenance` | mm/m, m |
| `CropParams` | ver [crop-catalog](../02-modules/crop-catalog.md) | |
| `ObservationPoint` | `date, variable ('ndvi'\|'soil_moisture'), value, provenance` | adim., m³/m³ |
| `TwinState` | `date, crop_id, stage: PhenoStage, gdd_cum, root_zone_depletion_mm, taw_mm, ks, et0, etc_adj, data_state` | °C·día, mm |
| `Discrepancy` | `date, variable, observed, simulated, delta` | |
| `Recommendation` | `sequence: list[str], score, indicators{water,soil,climate}, status, warnings, data_state` | 0–100 |
| `Farm` (PROPUESTA) | `farm_id, parcel_id, name, zones: list[FarmZone]` (MVP 1–4 zonas) | |
| `FarmZone` (PROPUESTA) | `zone_id, name, crop_id, area_ha, geometry (GeoJSON), soil: SoilProfile, irrigation_level: IrrigationLevel` | ha |
| `ZoneResult` (PROPUESTA) | `zone_id, crop_id, area_ha, states: list[TwinState], ndvi: float \| None, ndvi_state: DataState, stress_class, data_state` | adim. |

## Ejemplo: `POST /api/rotations/recommend`

Entrada:
```json
{
  "location": {"lat": 41.995, "lon": -93.49},
  "farm": {"current_crop": "corn", "previous_crop": "soybean", "irrigation": false, "soil_texture": null},
  "planning": {"cycles": 3, "weights": {"water": 0.4, "soil": 0.35, "climate": 0.25}}
}
```

Salida:
```json
{
  "methodology": "multicriteria_v1",
  "data_mode": "synthetic",
  "recommendations": [
    {"sequence": ["corn", "soybean", "corn"], "score": 73.1, "status": "PRELIMINARY",
     "indicators": {"water": 70.0, "soil": 65.0, "climate": 80.0},
     "warnings": ["soil analysis missing"], "data_state": "SYNTHETIC"}
  ],
  "provenance": {"climate": "synthetic:weather_v1", "crops": "catalog_v1"}
}
```
Cifras de ejemplo, no reales.

## Ejemplo: `POST /api/twin/simulate` (PROPUESTA implementada)

```json
{"farm_id": "story_pilot_farm", "start": "2024-04-01", "end": "2024-10-31",
 "scenario": {"precip_factor": 1.0, "temp_delta_c": 0.0, "irrigation_level": null, "preset": "moderate_drought"},
 "fork_date": "2024-07-01", "zone_ids": null, "planting_dates": {"corn": "2024-05-05"},
 "monte_carlo": {"n": 40, "seed": 20261114}, "include_states": true, "include_comparison": true}
```
Todos los campos son opcionales (por defecto: granja piloto, abr–oct 2024, escenario neutro). `start` y `end` deben caer en el mismo año (una temporada); el motor arranca 30 días antes de la siembra más temprana y recorta la salida. `preset` se expande en el servidor y `scenario_expanded` lo devuelve. `irrigation_level` es un override global (el riego del escenario solo aplica después de `fork_date`). El cultivo de cada zona en el año simulado sale de su historial CDL.

Respuesta: `{"methodology": "twin_v1", "catalog_version", "data_mode", "twin_level", "farm_id", "start", "end", "scenario", "scenario_expanded", "zones": [ZoneResult...], "farm_summary", "warnings", "provenance": {"weather", "crops", "farm_parcel", "farm_terrain", "farm_soil", "twin", "obs_modis_ndvi", "obs_sentinel2", "obs_smap"}}`.

- `TwinState.data_state`: `ESTIMATED` (línea base con clima medido), `SIMULATED` (días bifurcados por un escenario), `SYNTHETIC` (modo sintético).
- `ZoneResult.ndvi` es el **último NDVI observado ≤ `end`** con `ndvi_state`/`ndvi_source`: el gemelo no simula NDVI. `expected_canopy` es el Kc normalizado (forma), no NDVI.
- `comparison` (siempre contra la línea base): NDVI MODIS y Sentinel-2 como forma normalizada (`correlation`, `mean_abs_delta`, picos, `lag_days` solo si la serie cubre el reverdecimiento) y SMAP como anomalías estandarizadas.
- `stress_class` sale de umbrales sobre `ks` (ADR-018). `twin_level` = `DIGITAL_SHADOW` con datos reales, `DIGITAL_MODEL` con sintéticos (ADR-017).

## Versionado

`methodology` (`multicriteria_v1`, `twin_v1`) y `catalog_version` en cada respuesta. Cambio incompatible ⇒ subir versión + actualizar este doc en el mismo PR.

## Imágenes y contexto del piloto

- `GET /api/imagery/meta?farm_id=...`: límites WGS84 compartidos, ortofoto, fechas NDVI y procedencia.
- `GET /api/imagery/basemap?farm_id=...&size=2048`: JPEG limitado a 2048 px por lado.
- `GET /api/imagery/ndvi/dates?farm_id=...`: fechas, fracción válida y disponibilidad de derivados.
- `GET /api/imagery/ndvi?farm_id=...&date=YYYY-MM-DD&size=1024`: PNG RGBA; en modo S3 se calcula por ventanas desde bandas remotas.
- `GET /api/terrain/heightmap?farm_id=...`: grilla de elevaciones norte→sur sobre los mismos límites.
- `GET /api/region/summary?period_start=...&period_end=...`: métricas y diferencias frente al periodo anterior de igual longitud; advierte cobertura incompleta. El NDVI representa observaciones del piloto, no un promedio espacial regional. Aptitud ausente hasta disponer del derivado GAEZ.
- `GET /api/data/catalog`: disponibilidad de almacenes, inventario y contadores de transferencia/caché.

Parcela desconocida o imagen ausente devuelve 404; fecha o tamaño inválidos, 422; almacenamiento obligatorio inaccesible, 503. Nunca se entregan credenciales ni identificadores del bucket.

## Consulta histórica por punto

`POST /api/points/query` recibe `{lat, lon, start?, end?, refresh?}`. Coordenadas finitas dentro de WGS84, normalizadas a cinco decimales antes de consultar y responder; intervalo ordenado de máximo 730 días, sin fechas futuras. Por defecto termina siete días antes de hoy y empieza 730 días antes de ese fin. `refresh` omite la caché de lectura.

La respuesta contiene `point`, `period` y `sections` con `coverage`, `terrain`, `soil`, `climate`, `vegetation`, `suitability`. Cada sección lleva `status` (`ok|error`), `data` (objeto de la fuente con claves originales en español o `null`), `error`, `source`, `data_state` y `elapsed_s`. Fuentes caídas producen errores por sección con HTTP 200; el resto se conserva. Validación devuelve 422 y capacidad agotada 503. Errores externos se sanitizan.

Los datos se consultan bajo demanda, pero son históricos o productos de referencia: WorldCover/LULC, Copernicus DEM, SoilGrids, POWER, Sentinel-2 y GAEZ 1981–2010. No representan sensores de campo en tiempo real. POWER y modelos de suelo/aptitud se etiquetan `ESTIMATED`. La vegetación revisa como máximo 128 escenas y devuelve un aviso de posible truncamiento.

Se permiten cuatro consultas concurrentes por proceso. La sesión impide nuevas solicitudes tras 90 s y limita cada espera de red a 20 s (la finalización puede superar el plazo mientras concluye una solicitud en curso). Solo respuestas completas se guardan, durante 24 h; archivos corruptos o con secciones fallidas se vuelven a consultar. Los reemplazos de caché son atómicos.
