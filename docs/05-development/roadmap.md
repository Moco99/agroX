# Roadmap

> TL;DR: F0 contratos → F1 gemelo SINTÉTICO de punta a punta → F2 clima real → F3 suelo/catálogo/parcela reales → F4 sincronización satelital → F5 backtest, Copilot y demo. Incluye checklist sintético→real.
> Depende de: [project-brief](../00-overview/project-brief.md)
> Estado: draft
> Última revisión: 2026-11-14

Ventana: ~36 h. Features pequeñas (≤ ~4 h), una rama cada una ([git-workflow](git-workflow.md)). Modelos: [agent-routing](../06-agents/agent-routing.md).

## Fases

| Fase | Entregable | Criterio de salida | Lidera | Paralelo con |
|---|---|---|---|---|
| **F0** Contratos y esqueleto | `backend/` FastAPI con `/api/health`; `schemas/` Pydantic de [data-contracts](../01-architecture/data-contracts.md); `providers/ports.py`; `frontend/` Vite+TS+Tailwind con store y tipos; CI de lint+tests | `pytest` y `vitest` verdes; OpenAPI publica todos los modelos; tipos TS compilan contra fixtures JSON | Opus (contratos) · Sonnet (esqueletos) · Fable (aprueba) | — |
| **F1** Gemelo sintético E2E | Generadores sintéticos → engine (ET0, Kc, balance, GDD) → `/api/twin/simulate`, `/api/rotations/recommend`, `/api/scenarios/simulate` → UI shell ([ui-spec](../07-design/ui-spec.md): layout, tokens, i18n) + pantalla S2 (parcela, NDVI sintético) + S3 (diorama 3D por zonas, controles de escenario y riego, timeline) + gráfica Recharts + banner "datos sintéticos"; What If con factores, años análogos y Monte Carlo sobre clima sintético multi-año | Demo completa navegable en modo `synthetic`; golden tests e invariantes verdes; `twin_level = DIGITAL_MODEL` visible | Opus (engine) · Sonnet (UI, generadores, cableado) | F2 prep, F3 prep (ingesta) |
| **F2** Clima real | `pipeline/build_weather.py` → `derived/weather/power_daily_<site>.csv`; `RealWeatherProvider`; unidades verificadas (O-6); historia larga POWER (O-7) | `RealWeatherProvider` pasa tests de contrato; ET0 real plausible (chequeo PM vs Hargreaves); `twin_level = DIGITAL_SHADOW` | Opus (unidades/ET0) · Sonnet (loader) | F1 (UI), F3 |
| **F3** Suelo, catálogo y parcela reales | `SoilProfile` desde SSURGO/SDA; `catalog_v1` con fuentes y `verified`; parcela piloto desde CDL 2021–2024 + historial | Providers reales pasan contrato; catálogo sin `null` en campos que usa el motor o con warnings explícitos | Opus (SSURGO/SDA, catálogo) · Fable (revisa honestidad del catálogo) | F2, F4 |
| **F4** Sincronización satelital | NDVI MODIS (y Sentinel-2 si se arregla deuda a) → doble logística → `compare()` → discrepancias en UI; SMAP como contexto; nudging = stretch | Gráfica simulado vs observado con discrepancia; `twin_level = DIGITAL_TWIN` solo con observación contrastada | Opus | F3, F5 (UI de discrepancia: Sonnet) |
| **F5** Backtest, Copilot, pulido, demo | Backtest RF/GBM vs NASS (leave-one-year-out, fuera del motor); Copilot (template + LLM opcional); pantalla Informe; guion de demo de 4 min y pitch | Demo de 4 min ensayada offline con `derived/` empaquetado; textos revisados por Fable | Fable (pitch, honestidad) · Sonnet (UI) · Opus (backtest) | — |
| **F5 stretch** Globo S1 | Pantalla de aterrizaje con globo (`three-globe` o esfera R3F) y panel de región | Funciona offline; no retrasa el flujo parcela → gemelo | Sonnet | resto de F5 |

Orden crítico: F0 → F1 bloquea todo lo demás de UI. F2/F3 pueden empezar su ingesta (pipeline) en paralelo con F1. F4 requiere F2 (clima real) para que la comparación tenga sentido.

## Recorte si falta tiempo (de último a primero)

1. Globo S1, búsqueda ⌘K, capas 3D de temperatura/humedad; nudging/Kalman, SPEI, AHP, backtest ML.
2. Sentinel-2 (quedarse con MODIS).
3. Copilot LLM (queda template).
4. Monte Carlo (queda años análogos + factores).
Nunca se recorta: banner de datos sintéticos, provenance, regla "score ≠ probabilidad".

## Criterios para sustituir sintético por real (checklist por puerto)

- [ ] Existe `derived/<version>/...` generado por un script de `pipeline/` reproducible, con insumos en el manifest.
- [ ] Unidades verificadas contra la documentación oficial de la fuente y convertidas a las canónicas.
- [ ] El adaptador `Real*` devuelve el **mismo modelo Pydantic** y pasa **todos** los tests de contrato del puerto.
- [ ] Faltantes tratados (`NaN` + `warnings`), sin rellenar con sintético en silencio.
- [ ] Cobertura temporal y espacial suficiente para el uso (p. ej. clima multi-año para análogos/SPI; NDVI de temporada completa).
- [ ] `data_state` correcto (`MEASURED`/`ESTIMATED`) y `source` con id de [sources](../04-data/sources.md).
- [ ] Golden tests del engine siguen verdes con sintético (el motor no cambió).
- [ ] Test de plausibilidad con datos reales (rangos físicos: T, P ≥ 0, ET0 ≥ 0, 0 ≤ NDVI ≤ 1).
- [ ] Revisión por Opus (lógica/unidades) distinto del constructor.
- [ ] UI deja de mostrar el banner sintético **solo** si ningún valor de la vista es `SYNTHETIC`.
- [ ] Docs actualizados (data-pipeline, sources, navigation.yaml si aplica).
