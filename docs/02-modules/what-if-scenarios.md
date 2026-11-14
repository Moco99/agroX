# What If (`what_if`)

> TL;DR: Escenarios hipotéticos que bifurcan el gemelo y recalculan el ranking: factores de lluvia/temperatura, pesos, ciclo, años análogos y Monte Carlo. Todo sale como SIMULATED.
> Depende de: [digital-twin-engine](digital-twin-engine.md), [rotation-engine](rotation-engine.md)
> Estado: draft
> Última revisión: 2026-11-14

Endpoint: `POST /api/scenarios/simulate` (y `POST /api/twin/simulate` con `scenario`). Contrato en [data-contracts](../01-architecture/data-contracts.md).

## Controles

| Control | Efecto en cálculo | Efecto en interfaz |
|---|---|---|
| Lluvia −X % (`precip_factor`) | Escala precipitación diaria → nuevo balance hídrico → A | Indicadores y ranking cambian |
| Temperatura +X °C (`temp_delta_c`) | Desplaza t_max/t_min → GDD, ET0, días sobre umbral → C, A | Aviso de escenario y tono ambiental 3D |
| Pesos (`weights`) | Solo re-pondera (no re-simula) | Reordena tarjetas en tiempo real |
| Ciclo activo | Selecciona cultivo de la secuencia | Cambia el modelo vegetal 3D |
| Años análogos | Reemplaza el clima futuro por años históricos similares (modelo 12) | Banda de resultados |
| Monte Carlo | N realizaciones de clima perturbado (modelo 13) | Distribución (p10–p50–p90) del score/indicadores |

| Nivel de riego (`irrigation_level`, **nuevo**) | Añade `I_i` (mm) al balance hídrico de cada zona → `ks`, estrés | Segmentado Sin riego/Bajo/Medio/Alto; aspersores en 3D |
| Preset (`scenario_preset`) | Se expande a `precip_factor` + `temp_delta_c` (+ riego opcional) | Selector "Escenario: <nombre>" en S3 |

Rangos permitidos de los controles: TBD (proponer y validar; rechazar fuera de rango con 422).

## Controles de los mockups (S3, [ui-spec](../07-design/ui-spec.md))

| UI | Parámetro | Nota |
|---|---|---|
| "Reducción de precipitación −30 %" | `precip_factor = 0.70` | Slider; signo explícito |
| "Aumento de temperatura +2,0 °C" | `temp_delta_c = 2.0` | Slider |
| "Nivel de riego" | `irrigation_level` | mm por nivel TBD (O-15) |
| "Humedad del suelo (prom.)" | **salida**, no control | Se muestra como lectura del gemelo (O-13), no como slider editable |
| "Etapa del cultivo (predom.)" | **salida** / selector de fecha | Salta la timeline a esa etapa; no fuerza la etapa |

Presets: `baseline` (factores neutros), `moderate_drought` ("sequía moderada"), otros a definir. Parámetros de cada preset = **TBD (O-14)**; los números del mockup son ilustrativos. Un preset aplicado sigue siendo editable y la UI marca "Personalizado" al tocar un control.

## Reglas

- Todo resultado de escenario lleva `data_state = SIMULATED` (o `SYNTHETIC` si el clima base es sintético; prevalece `SYNTHETIC`).
- Pesos: recalcular solo ranking (barato, instantáneo en UI). Clima: re-simular gemelo (más caro; cachear por `(parcel, crop, scenario)`).
- Monte Carlo: `numpy.random.Generator` con seed explícita en la petición o fija por defecto → resultados reproducibles.
- Años análogos y Monte Carlo requieren clima multi-año: en F1 se usan sobre **clima sintético multi-año**; con real, tras O-7 (historia larga POWER).
- Mostrar en pantalla (dossier): "Las simulaciones son exploratorias. No representan predicciones validadas de rendimiento, erosión, nitrógeno ni disponibilidad exacta de agua por parcela."

## Ejemplo de demo

1. Mostrar estrategia de referencia.
2. El jurado reduce lluvia 20 %.
3. AGROX recalcula A y el ranking; una rotación sube o baja.
4. La escena 3D cambia (estrés, tono) con badge "Simulación".

## Implementación

- `engine/scenarios/perturb.py` (factores), `analog_years.py`, `monte_carlo.py` (puros; reciben `rng`).
- Reutiliza `engine.twin.fork` y `engine.rotation.ranking`.
- Riego: `irrigation_level` entra por `TwinScenario`/`FarmZone` ([digital-twin-engine](digital-twin-engine.md)).
- Builder: Opus (años análogos, Monte Carlo, riego en el balance); Sonnet (controles UI). Ver [agent-routing](../06-agents/agent-routing.md).
