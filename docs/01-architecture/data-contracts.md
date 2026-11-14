# Contratos de datos y API

> TL;DR: Único dueño del contrato: endpoints, modelos Pydantic base, provenance y reglas. Synthetic* y Real* devuelven exactamente estos modelos.
> Depende de: [glossary](../00-overview/glossary.md)
> Estado: draft (endpoints `/api/twin/*`, `/api/observations/*` y modelo por zonas = propuesta)
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
| GET | `/api/twin/state?parcel_id&date` | `TwinState` de un día | **propuesta** |
| POST | `/api/twin/simulate` | serie de `TwinState` + discrepancias (por zona si se envía `farm`) | **propuesta** |
| GET | `/api/observations/ndvi?parcel_id&start&end` | serie NDVI (media por parcela/zona) | **propuesta** |
| GET | `/api/observations/ndvi-overlay?parcel_id&date` | PNG coloreado (escala de [design-tokens](../07-design/design-tokens.md)) + `bounds` + `resolution_m` + `source` | **propuesta** |

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

## Ejemplo: `POST /api/twin/simulate` (propuesta)

```json
{"parcel_id": "story_pilot_01", "crop_id": "corn", "planting_date": "2024-05-05",
 "start": "2024-04-01", "end": "2024-10-31", "scenario": {"precip_factor": 1.0, "temp_delta_c": 0.0}}
```
Respuesta: `{ "twin_level": "DIGITAL_SHADOW", "states": [TwinState...], "discrepancies": [Discrepancy...], "warnings": [], "provenance": {...} }`.

Variante por zonas (PROPUESTA, mockup S3 en [ui-spec](../07-design/ui-spec.md)): en vez de `crop_id` se envía `"farm": {"farm_id": "story_pilot_farm", "zones": [FarmZone...]}` y opcionalmente `"scenario_preset": "moderate_drought"` e `"irrigation_level": "MEDIUM"` (override global). El preset se expande en el servidor a `precip_factor`/`temp_delta_c` (valores TBD, O-14) y la respuesta lo devuelve expandido. Salida: `{"twin_level", "zones": [ZoneResult...], "warnings", "provenance"}`. `stress_class` sale de umbrales sobre `ks` (TBD, O-16); `ndvi` es **observado** (o sintético) a la fecha, con su `ndvi_state`: el gemelo no simula NDVI (bajo escenario, la capa principal del 3D es estrés por `ks`).

`twin_level` = `DIGITAL_TWIN` solo si hay observaciones independientes comparadas en el periodo.

## Versionado

`methodology` (`multicriteria_v1`, `twin_v1`) y `catalog_version` en cada respuesta. Cambio incompatible ⇒ subir versión + actualizar este doc en el mismo PR.
