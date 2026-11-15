# Rotation Engine (`rotation`)

> TL;DR: Prototipo EcoCrop de siete cultivos con índices comparativos de ajuste a precipitación, temperatura y pH declarado; pondera secuencias y calcula escenarios. No es predicción de rendimiento ni evaluación validada del agua o suelo.
> Depende de: [data-contracts](../01-architecture/data-contracts.md), [crop-catalog](crop-catalog.md), [model-specs](../03-models/model-specs.md)
> Estado: draft
> Última revisión: 2026-11-15

Endpoint: `POST /api/rotations/recommend` ([data-contracts](../01-architecture/data-contracts.md)).

## Implementado actualmente

`rotation_service` usa la serie climática de la parcela y `ecocrop.parquet` local, genera secuencias de 2–4 ciclos para siete cultivos y ordena los proxies EcoCrop con pesos normalizados. Un pH ausente excluye suelo del ranking, en vez de atribuir al lugar un valor supuesto. Si faltan umbrales requeridos, se excluye la secuencia. Se pueden aplicar condiciones hipotéticas de lluvia y temperatura y excluir secuencias con familias consecutivas iguales, incluida la del cultivo previo declarado.

El proxy de agua compara precipitación del periodo con umbrales EcoCrop cuya escala temporal todavía requiere validación; no es disponibilidad ni demanda de riego. El proxy de suelo es ajuste de pH, no salud o protección del suelo. Cada ciclo puede usar una ventana climática propia. Sin ventanas declaradas la temperatura y precipitación del periodo común se reutilizan. En empate se prefieren menos repeticiones de familia botánica y, si persiste, se ordena por los identificadores de la secuencia. Los resultados no están validados en campo y no son probabilidades. El clasificador RF fue entrenado con etiquetas sintéticas y se desactiva en esta API. Los periodos con datos climáticos incompletos generan un error con las fechas afectadas. Para cultivos del catálogo del gemelo se avisa si la ventana declarada es más corta que la duración estimada del cultivo. Hay que declarar `farm_id`, `start` y `end`: el cuerpo anterior con supuestos por defecto ya no es compatible.

### Ajuste EcoCrop por temporada (bloque mensual más limitante)

Antes, cada ciclo se juzgaba con la temperatura media de toda la ventana. Con una ventana abr–oct en Iowa (19 °C de media) 8 de 9 cultivos obtenían 100 en clima: la media escondía un abril frío. Ahora se sigue el método EcoCrop publicado (Hijmans et al. 2001, DIVA-GIS; Ramirez-Villegas et al. 2013, *Agric. For. Meteorol.* 170:67–78):

- La temporada dura la media de `gmin` y `gmax` del cultivo, igual que la implementación `dismo::ecocrop`.
- Dentro de la ventana declarada se busca, por semanas, la fecha de inicio con mejor ajuste. El paso semanal es una resolución de producto.
- La temperatura se juzga por bloques de 30 días y manda el bloque peor (ley del mínimo). La lluvia se compara como total de esa temporada.
- Si la ventana es más corta que la temporada, se usa la ventana entera y la lluvia se extrapola a su tasa diaria, con aviso.
- Cada ciclo devuelve `season` con las fechas elegidas y la temperatura del bloque limitante.

No se cambió ningún rango de EcoCrop. Limitación conocida: algunos registros tienen `gmax` muy largo (maíz 365 días, temporada de 215 días). Ese maíz ocupa toda la ventana abr–oct y el abril frío lo limita. No se ajusta a mano: se informa en `explanation`. Para acotarla, declara ventanas por ciclo.

### Componente de rotación

El índice agroclimático puntúa cada ciclo por separado, así que el mejor cultivo repetido siempre ganaba («Maíz → Maíz → Maíz» con 100). Ahora el índice final combina dos partes:

`score = (1 − rotation_weight) · agroclimatic_score + rotation_weight · rotation.index`

`rotation_weight` vale 0.3 por defecto y se puede cambiar en la petición. `rotation.index` (0–100) sale solo de la secuencia y del `previous_crop` declarado, con tres criterios:

| Componente | Peso | Cálculo |
|---|---|---|
| `family_break` | 0.5 | Media por transición: 100 si cambia la familia, 50 si es otro cultivo de la misma familia, 0 si se repite el cultivo. |
| `legume_before_non_legume` | 0.25 | 100 × fracción de transiciones leguminosa → no leguminosa (aporte de N biológico). |
| `family_diversity` | 0.25 | 100 × (familias distintas − 1) / (ciclos − 1). |

Los criterios tienen respaldo en la literatura: USDA-NRCS, norma de práctica 328 *Conservation Crop Rotation*; Bullock (1992), *Crit. Rev. Plant Sci.* 11:309–326; Karlen et al. (1994), *Adv. Agron.* 53:1–45; Peoples et al. (2009), *Symbiosis* 48:1–17; FAO (2011), *Save and Grow*. **Las magnitudes (50/100, 0.5/0.25/0.25, 0.3) son pesos de producto para un índice comparativo, no efectos medidos.** No se afirma ningún aumento de rendimiento ni crédito de N en kg/ha.

Otras reglas:

- Por defecto se excluye repetir el mismo cultivo en ciclos consecutivos, también después de `previous_crop`. Con `allow_consecutive_same_crop: true` se puede comparar el monocultivo, que recibe 0 en el componente de rotación.
- Las alternativas se eligen por orden de índice. Primero se toman secuencias con conjuntos de cultivos distintos, para no listar variantes casi iguales como maíz-frijol-maíz y frijol-maíz-frijol. Si no alcanzan, se completa con las siguientes mejores.
- Cada recomendación trae `agroclimatic_score`, `rotation` (índice, componentes, pesos y conteos), `breakdown` (incluye `rotation`; su suma es `score`) y `explanation` (frases es-MX para la UI).

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
- `R1_same_family_repeat`: implementado como componente `family_break` (ver arriba); descarte opcional con `exclude_same_family`.
- `R2_n_fixer_after_cereal`: implementado como componente `legume_before_non_legume` (bonificación, no descarte).
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
