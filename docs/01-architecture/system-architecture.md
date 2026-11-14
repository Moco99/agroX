# Arquitectura del sistema

> TL;DR: Hexagonal ligera: router → service → engine (puro) → provider (puerto) con adaptadores Synthetic*/Real*. El frontend solo representa.
> Depende de: [glossary](../00-overview/glossary.md)
> Estado: draft
> Última revisión: 2026-11-14

## Vista de capas

```
React (Vite)  ── REST/JSON ──►  FastAPI routers   (validación Pydantic, sin lógica)
                                      │
                                 services          (orquesta: pide datos a providers, llama al engine)
                                      │
                ┌─────────────────────┴───────────────────────┐
           engine/ (puro)                                 providers/ (puertos)
   twin · climate_indicators · rotation          WeatherProvider · SoilProvider
   scenarios · scoring                           CropCatalogProvider · ObservationProvider
   sin I/O, determinista                               │                 │
                                                Synthetic*          Real*  ──► data/derived/*.json|csv
                                                (seed fija)                     (empaquetado, sin red)
```

## Reglas duras

1. **Engine puro:** funciones sin I/O, sin red, sin reloj, sin aleatoriedad global. Aleatoriedad solo vía `numpy.random.Generator` recibido como parámetro (seed explícita).
2. **Toda entrada pasa por un puerto.** El engine nunca sabe si el dato es sintético o real.
3. **Contratos idénticos** para `Synthetic*` y `Real*`: mismo modelo Pydantic, mismos tests de contrato ([testing-strategy](../05-development/testing-strategy.md)).
4. **Provenance obligatoria:** toda serie o valor expuesto lleva `data_state` y `source` ([data-contracts](data-contracts.md)).
5. **Routers sin lógica de negocio:** validan, llaman a un service, devuelven.
6. **El frontend no calcula ciencia.** Traduce resultados a mapa, gráficas y escena 3D.
7. **Sin red en runtime de demo:** `Real*` lee `derived/` local; la ingesta corre aparte ([data-pipeline](../02-modules/data-pipeline.md)).

## Puertos (interfaces)

| Puerto | Devuelve | Synthetic | Real |
|---|---|---|---|
| `WeatherProvider` | `WeatherSeries` diaria | Generador estacional + ruido | `derived/weather/power_daily_<site>.csv` |
| `SoilProvider` | `SoilProfile` | Perfil fijo sintético | `derived/soil/<parcel_id>.json` (SSURGO/SDA) |
| `CropCatalogProvider` | `CropCatalog` | Parámetros provisionales | `derived/catalog/catalog_v1.json` verificado |
| `ObservationProvider` | `ObservationSeries` (NDVI, SMAP) | NDVI doble logística + ruido | `derived/obs/ndvi_modis_<parcel_id>.csv`, `smap_*.csv` |

Selección del adaptador por variable de entorno `AGROX_DATA_MODE=synthetic|real` (por puerto se permite override, p. ej. `AGROX_WEATHER_MODE`), resuelta en un único módulo `providers/factory.py`.

## Flujo de una petición (ej. `POST /api/twin/simulate`)

1. Router valida `TwinSimulateRequest`.
2. `twin_service` obtiene clima, suelo, cultivo y observaciones de los providers.
3. `engine.twin.run_season(...)` produce `TwinState` diario (determinista).
4. Si hay observaciones: `engine.twin.compare(...)` → discrepancias.
5. Service arma `TwinSimulateResponse` con provenance y `twin_level`.

## Estado compartido del frontend

Un store (Zustand o Context, O-10) con: parcela seleccionada, ciclo activo, rotación seleccionada, escenario activo, `data_mode`. Mapa 2D, gráficas y escena 3D leen del mismo store; nunca duplican estado.

## Resiliencia

- Si falta un dato real, el service lo marca como faltante en `warnings`; nunca lo rellena en silencio con sintético.
- Si el modo es mixto (p. ej. clima real + suelo sintético), la respuesta lo dice por campo y la UI muestra el aviso.

Detalle de módulos: [02-modules](../02-modules/). Estructura de carpetas: [repo-structure](repo-structure.md).
