# Catálogo de modelos (18)

> TL;DR: Qué modelo se usa, dónde y por qué. Núcleo de proceso (explicable, sin entrenamiento por parcela); ML solo como contraste; LLM solo redacta.
> Depende de: [glossary](../00-overview/glossary.md)
> Estado: draft
> Última revisión: 2026-11-14

Ecuaciones y unidades: [model-specs](model-specs.md). Justificación global: ADR-005 en [decisions](../00-overview/decisions.md).

| # | Modelo | Clase | MVP |
|---|---|---|---|
| 1 | Penman-Monteith FAO-56 (ET0) | Proceso | Sí |
| 2 | Hargreaves (ET0 respaldo) | Proceso | Sí |
| 3 | Coeficiente de cultivo Kc | Proceso | Sí |
| 4 | Balance hídrico diario FAO-56 | Proceso | Sí |
| 5 | Grados-día (GDD) | Proceso | Sí |
| 6 | Multicriterio ponderado | Decisión | Sí |
| 7 | Reglas de restricción de rotación | Decisión | Sí |
| 8 | Anomalía % de precipitación | Indicador | Sí |
| 9 | SPI / SPEI | Indicador | Stretch |
| 10 | Días bajo/sobre umbral térmico | Indicador | Sí |
| 11 | Índice de pendiente/erosión (SRTM) | Indicador | Sí (simple) |
| 12 | Años análogos | Simulación | Sí |
| 13 | Monte Carlo | Simulación | Sí |
| 14 | AHP + análisis de sensibilidad | Decisión | Sensibilidad sí; AHP stretch |
| 15 | Nudging / filtro de Kalman | Estimación de estado | Stretch |
| 16 | Savitzky-Golay + doble logística (NDVI) | Señal | Sí (F4) |
| 17 | Random forest / gradient boosting | ML | Stretch, fuera del motor |
| 18 | Claude (LLM) | LLM | Opcional |

## Proceso

**1. Penman-Monteith FAO-56**
Dónde se usa:
- ET0 diaria del gemelo (paso diario).
- Indicador ET0 en Earth Scanner.
Por qué se usa: estándar FAO para ET de referencia; POWER entrega todas sus entradas (T, RH, viento, radiación).

**2. Hargreaves**
Dónde se usa:
- ET0 cuando falta RH, viento o radiación.
- Chequeo de consistencia contra Penman-Monteith.
Por qué se usa: solo requiere temperatura; robusto ante huecos de datos.

**3. Kc (ETc = Kc × ET0)**
Dónde se usa:
- Demanda hídrica del cultivo por etapa en el gemelo.
Por qué se usa: traduce ET de referencia a cultivo concreto con parámetros tabulados y explicables.

**4. Balance hídrico del suelo FAO-56**
Dónde se usa:
- Estado `root_zone_depletion_mm` y estrés `Ks` del gemelo.
- Indicador A del Rotation Engine.
- Escenarios de lluvia en What If.
Por qué se usa: modelo de un solo depósito, explicable, con entradas disponibles (clima + AWC de suelo).

**5. Grados-día (GDD)**
Dónde se usa:
- Etapa fenológica del gemelo.
- Indicador C y regla de ciclo.
- Escenarios de temperatura.
Por qué se usa: la fenología responde a temperatura acumulada mejor que a días calendario.

## Decisión / reglas

**6. Multicriterio ponderado**
Dónde se usa:
- Score S del ranking de rotaciones.
Por qué se usa: transparente; el usuario ve y cambia los pesos.

**7. Reglas de restricción de rotación**
Dónde se usa:
- Fase 2 del Rotation Engine (descartes con razón).
Por qué se usa: conocimiento agronómico explícito y auditable.

**14. AHP + sensibilidad**
Dónde se usa:
- Derivar pesos desde comparaciones por pares (opcional).
- Mostrar estabilidad del ranking ante cambios de pesos.
Por qué se usa: justifica los pesos y expone la fragilidad del ranking.

## Indicadores / estadística

**8. Anomalía % de precipitación**
Dónde se usa:
- Earth Scanner; contexto de escenarios.
Por qué se usa: simple y comprensible; no es diagnóstico de sequía por sí sola.

**9. SPI / SPEI**
Dónde se usa:
- Earth Scanner (con historia larga).
- Selección de años análogos.
Por qué se usa: índice estandarizado reconocido; SPEI incorpora ET.

**10. Días bajo/sobre umbral térmico**
Dónde se usa:
- Earth Scanner; indicador C.
Por qué se usa: estrés térmico comprensible para el productor.

**11. Pendiente/erosión (SRTM)**
Dónde se usa:
- Indicador Ssuelo; relieve opcional en 3D.
Por qué se usa: la pendiente es el factor de erosión más accesible con datos abiertos.

## Simulación de escenarios

**12. Años análogos**
Dónde se usa:
- What If: clima futuro plausible a partir de años históricos similares.
Por qué se usa: preserva la coherencia física de un año real; fácil de explicar.

**13. Monte Carlo**
Dónde se usa:
- What If: distribución p10–p50–p90 de indicadores y score.
Por qué se usa: muestra incertidumbre en lugar de una cifra única.

## Estimación de estado

**15. Nudging / Kalman**
Dónde se usa:
- Corrección del estado del gemelo con observaciones (stretch).
Por qué se usa: es lo que convierte la sombra digital en gemelo que se corrige; en MVP solo se compara.

## Señal

**16. Savitzky-Golay + doble logística**
Dónde se usa:
- Suavizar NDVI y extraer fechas fenológicas para comparar con el gemelo.
Por qué se usa: estándar en fenología satelital; tolera nubes y huecos.

## ML y LLM

**17. Random forest / gradient boosting**
Dónde se usa:
- Backtest de plausibilidad vs rendimientos NASS por condado, leave-one-year-out.
Por qué se usa: contraste independiente; **nunca** dentro del motor ni como predicción mostrada como tal.

**18. Claude (Copilot)**
Dónde se usa:
- Redactar explicaciones en `/api/copilot/explain`.
Por qué se usa: lenguaje natural sobre datos estructurados; no calcula.
