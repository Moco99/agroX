# Rotation Engine (`rotation`)

> TL;DR: Genera secuencias de cultivos, descarta las que violan reglas, calcula indicadores A/Ssuelo/C (0–100) usando el gemelo y ordena con S = wa·A + ws·Ssuelo + wc·C.
> Depende de: [data-contracts](../01-architecture/data-contracts.md), [crop-catalog](crop-catalog.md), [model-specs](../03-models/model-specs.md)
> Estado: draft
> Última revisión: 2026-11-14

Endpoint: `POST /api/rotations/recommend` ([data-contracts](../01-architecture/data-contracts.md)).

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
