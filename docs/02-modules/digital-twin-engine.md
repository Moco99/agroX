# Digital Twin Engine (`twin`)

> TL;DR: Núcleo. Estado diario de la parcela (agua en suelo, etapa, estrés) que avanza con clima, se contrasta con observaciones satelitales y se bifurca en escenarios. Puro y determinista.
> Depende de: [system-architecture](../01-architecture/system-architecture.md), [data-contracts](../01-architecture/data-contracts.md), [model-specs](../03-models/model-specs.md)
> Estado: draft
> Última revisión: 2026-11-14

Definición y niveles de honestidad: ADR-003 en [decisions](../00-overview/decisions.md).

## Tres capacidades

| # | Capacidad | MVP (36 h) | Stretch |
|---|---|---|---|
| 1 | **Estado** diario: `root_zone_depletion_mm`, `stage`, `gdd_cum`, `ks` (estrés) | Sí | — |
| 2 | **Sincronización**: avanza con clima real (POWER); contrasta con NDVI (MODIS/Sentinel-2) y SMAP | Comparar y mostrar discrepancia | Nudging / Kalman (modelo 15) |
| 3 | **Simulación**: bifurcar el estado de un día D con escenarios | Sí (factores lluvia/temperatura, años análogos, Monte Carlo) | — |

**No hace:** predecir rendimiento, diagnosticar enfermedades, estimar nitrógeno. El 3D no es salida del gemelo, solo lo representa.

## Paso diario (orden fijo)

```
for day in season:
    et0      = penman_monteith(weather[day]) or hargreaves(weather[day])   # modelos 1/2
    gdd_cum += gdd(t_max, t_min, crop.t_base)                               # modelo 5
    stage    = stage_from_gdd_or_days(gdd_cum, crop)                        # catálogo
    kc       = kc_for_stage(stage, crop)                                    # modelo 3
    state    = water_balance_step(state, precip, et0, kc, soil, crop)       # modelo 4 → Dr, Ks, ETc_adj
    emit TwinState(day, ...)
```
Ecuaciones, unidades y límites en [model-specs](../03-models/model-specs.md).

## API del engine (`backend/app/engine/twin/`)

```python
from dataclasses import dataclass

import numpy as np

from app.schemas.twin import TwinState, TwinScenario, Discrepancy
from app.schemas.weather import WeatherSeries
from app.schemas.soil import SoilProfile
from app.schemas.crops import CropParams
from app.schemas.observations import ObservationSeries


@dataclass(frozen=True)
class SeasonInputs:
    weather: WeatherSeries
    soil: SoilProfile
    crop: CropParams
    planting_date_iso: str


# Pure: same inputs always give the same states; no I/O, no clock
def run_season(inputs: SeasonInputs, initial: TwinState | None = None) -> list[TwinState]: ...


# Branching keeps history up to `from_state` and only perturbs the future weather
def fork(from_state: TwinState, inputs: SeasonInputs, scenario: TwinScenario,
         rng: np.random.Generator | None = None) -> list[TwinState]: ...


# Discrepancy is reported, never hidden; aligns by date and variable
def compare(states: list[TwinState], observations: ObservationSeries) -> list[Discrepancy]: ...
```

(Firmas objetivo; el builder entrega implementación completa con docstrings y tests.)

## Sincronización: qué se compara

| Variable simulada | Observación | Cómo comparar | Advertencia |
|---|---|---|---|
| Etapa / desarrollo de canopia (vía Kc o GDD) | NDVI MODIS 250 m / 16 d (serie segura, 2 años) | Fechas clave (inicio verdor, pico, senescencia) de doble logística (modelo 16) vs etapas simuladas | Píxel mixto en 250 m; Sentinel-2 10 m mejor pero serie truncada (ver [data-pipeline](data-pipeline.md)) |
| Humedad del suelo | SMAP 9 km, superficie (~5 cm) | Anomalía/tendencia, no valor absoluto | Escala regional y capa superficial ≠ zona radicular: **solo contexto** |
| ET0 (proceso) | — | Consistencia Penman-Monteith vs Hargreaves | Diferencias esperables, documentarlas |

## Nivel de gemelo expuesto (`twin_level`)

- `DIGITAL_MODEL`: solo datos sintéticos o sin flujo de datos reales.
- `DIGITAL_SHADOW`: clima real alimenta el estado, sin observación contrastada.
- `DIGITAL_TWIN`: además hay observación independiente comparada en el periodo y se usa para decidir (rotación/escenario).

## Estado inicial y supuestos

- Depleción inicial: TBD (opción por defecto: perfil a capacidad de campo tras invierno; documentar como supuesto, `ESTIMATED`).
- Profundidad radicular: crece de mínima a máxima por etapa (FAO-56); valores TBD (verificar fuente: FAO-56 tabla 22 / catálogo).
- Sin riego salvo `farm.irrigation = true` (`DECLARED`) o `irrigation_level ≠ NONE` (ver abajo).

## Gemelo por zona (PROPUESTA)

Los mockups ([ui-spec](../07-design/ui-spec.md), S3) muestran una granja con varias zonas y cultivos distintos. Modelo: `Farm → zones: list[FarmZone]`; **cada zona es una instancia independiente** del gemelo (`run_season`/`fork` con su `crop_id`, `SoilProfile` e `irrigation_level`). La granja no tiene estado propio: agrega (área-ponderado) solo para KPI de resumen y lo etiqueta como agregado. MVP: 1–4 zonas. Contrato: [data-contracts](../01-architecture/data-contracts.md).

| Campo nuevo | Dónde | Efecto en el engine |
|---|---|---|
| `irrigation_level` (`IrrigationLevel`) | `FarmZone` o override del escenario | Término `I_i` del balance hídrico ([model-specs](../03-models/model-specs.md) §4); mm por nivel y regla de disparo TBD (O-15) |
| `scenario_preset` | petición | Se expande a `TwinScenario` antes del engine; el engine solo ve factores (O-14) |
| `stress_class` | `ZoneResult` | Clasificación de `ks` con umbrales TBD (O-16); el engine expone `ks`, la clase la pone el service |

Sin interacción lateral entre zonas en MVP (no hay flujo de agua entre ellas): supuesto documentado.

## Tests mínimos

Golden tests sobre clima sintético fijo; invariantes (0 ≤ Dr ≤ TAW, 0 ≤ Ks ≤ 1, `gdd_cum` no decreciente); `fork` sin cambios = `run_season`; determinismo con seed. Ver [testing-strategy](../05-development/testing-strategy.md).

Modelo responsable: Opus construye y revisa (ver [agent-routing](../06-agents/agent-routing.md)).
