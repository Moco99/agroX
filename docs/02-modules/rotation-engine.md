# Rotation Engine (`rotation`)

> TL;DR: Prototipo EcoCrop de siete cultivos con índices comparativos de ajuste a precipitación, temperatura y pH declarado; pondera secuencias y calcula escenarios. No es predicción de rendimiento ni evaluación validada del agua o suelo.
> Depende de: [data-contracts](../01-architecture/data-contracts.md), [crop-catalog](crop-catalog.md), [model-specs](../03-models/model-specs.md)
> Estado: draft
> Última revisión: 2026-11-14

Endpoint: `POST /api/rotations/recommend` ([data-contracts](../01-architecture/data-contracts.md)).

## Implementado actualmente

`rotation_service` usa la serie climática de la parcela y `ecocrop.parquet` local, genera secuencias de 2–4 ciclos para siete cultivos y ordena los proxies EcoCrop con pesos normalizados. Un pH ausente excluye suelo del ranking, en vez de atribuir al lugar un valor supuesto. Si faltan umbrales requeridos, se excluye la secuencia. Se pueden aplicar condiciones hipotéticas de lluvia y temperatura y excluir secuencias con familias consecutivas iguales, incluida la del cultivo previo declarado.

El proxy de agua compara precipitación del periodo con umbrales EcoCrop cuya escala temporal todavía requiere validación; no es disponibilidad ni demanda de riego. El proxy de suelo es ajuste de pH, no salud o protección del suelo. Cada ciclo puede usar una ventana climática propia. Sin ventanas declaradas la temperatura y precipitación del periodo común se reutilizan. En empate se prefieren menos repeticiones de familia botánica y, si persiste, se ordena por los identificadores de la secuencia. Los resultados no están validados en campo y no son probabilidades. El clasificador RF fue entrenado con etiquetas sintéticas y se desactiva en esta API. Los periodos con datos climáticos incompletos generan un error con las fechas afectadas. Para cultivos del catálogo del gemelo se avisa si la ventana declarada es más corta que la duración estimada del cultivo. Hay que declarar `farm_id`, `start` y `end`: el cuerpo anterior con supuestos por defecto ya no es compatible.

## Ensayo en el gemelo

La interfaz ofrece primero cultivos con parámetros disponibles en el gemelo y permite quitar ese filtro para explorar el catálogo EcoCrop. Cada ciclo compatible tiene la acción «Simular ciclo en 3D». El gemelo usa la misma parcela, ventana y factores climáticos de la comparación, aplica el cultivo a todas las zonas y permite cambiar de ciclo. Las fechas de siembra se toman del calendario del gemelo. Si la siembra queda fuera de la ventana, el ensayo informa el problema. Cada ciclo se ejecuta como una temporada independiente, con el suelo inicial de la parcela. Al volver a los cultivos de la parcela se carga la simulación habitual.

## Diseño propuesto, aún no implementado

Las secciones siguientes describen capacidades objetivo, no resultados actuales del servicio.

## Cuatro fases

| Fase | Operación | Salida | Modelo |
|---|---|---|---|
| 1. Candidatos | Secuencias cortas (`cycles` = 2–4) de cultivos del catálogo | Rotaciones posibles | — |
| 2. Restricciones | Familia botánica, fijadoras de N, ventana de siembra, duración de ciclo, historial | Válidas / descartadas (+ razón) | 7 |
| 3. Indicadores | A (hídrico), Ssuelo (protección), C (climático), 0–100 | Valores por secuencia | 3, 4, 5, 10 vía gemelo |
| 4. Priorización | Pesos del usuario normalizados; desglose y razones | Ranking | 6 (14 = AHP opcional) |

## Secuencias de referencia (piloto Iowa)

| A · Continuidad | B · Diversificación | C · Cobertura |
|---|---|---|
| corn → corn → corn | corn → soybean → corn | corn → cover → soybean |
| Referencia para comparar | Alterna familias botánicas | Evalúa protección del suelo |

Son conceptuales: validar especies, calendario, manejo y agua antes de recomendarlas. `cover` = `cereal_rye` u `oat` (O-3).

## Reglas de restricción (modelo 7) — formato

```python
from dataclasses import dataclass
from typing import Callable

from app.schemas.crops import CropParams


@dataclass(frozen=True)
class RuleResult:
    rule_id: str
    passed: bool
    reason: str


# Each rule is a pure predicate over a pair of consecutive crops; rules are data, so they can be listed in the UI
RotationRule = Callable[[CropParams, CropParams], RuleResult]
```

Reglas iniciales (parámetros TBD, verificar fuente agronómica):
- `R1_same_family_repeat`: penaliza/descarta misma familia consecutiva (umbral TBD).
- `R2_n_fixer_after_cereal`: favorece fijadora de N tras cereal (bonificación, no descarte).
- `R3_planting_window`: el cultivo siguiente debe caber en su ventana tras la cosecha previa.
- `R4_cycle_fits`: duración del ciclo compatible con temporada libre de heladas (catálogo + clima).
- `R5_history`: considera `previous_crop` declarado.

## Indicadores (definición operativa abierta, O-8)

Propuesta a validar por HEAD + Opus (no son parámetros científicos universales):

| Indicador | Propuesta | Fuente de datos |
|---|---|---|
| A (hídrico) | 100 × media de `Ks` del gemelo en el ciclo | gemelo (modelo 4) |
| Ssuelo | Puntaje por días con cobertura viva + pendiente (modelo 11) | catálogo + SRTM |
| C (climático) | 100 × fracción del ciclo dentro del rango térmico del cultivo, ajustado por GDD alcanzados | modelos 5, 10 |

## Interpretación (regla dura)

Un 80/100 **no** es "80 % de probabilidad de éxito". Es un **índice comparativo interno** dependiente de supuestos y reglas documentados. Cada recomendación muestra: desglose A/Ssuelo/C, pesos, reglas aplicadas, datos faltantes (`warnings`) y `data_state`.

## Sensibilidad

Mostrar cómo cambia el ranking si cada peso varía ±0.1 (modelo 14). Útil para el pitch: "el ranking es estable/inestable ante tus prioridades".

## Implementación

- `engine/rotation/candidates.py`, `rules.py`, `indicators.py`, `ranking.py` (puros).
- `services/rotation_service.py`: obtiene catálogo, corre el gemelo por ciclo, ensambla.
- Builder: Opus. Revisor: Opus distinto o Fable para honestidad del mensaje ([agent-routing](../06-agents/agent-routing.md)).
