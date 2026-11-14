# Data pipeline (`data_pipeline`)

> TL;DR: `scraper/` baja crudo a `data/raw/` (+manifest); `pipeline/` (por crear) transforma a `derived/` pequeño que leen los adaptadores Real*. Incluye la deuda técnica conocida del recolector.
> Depende de: [sources](../04-data/sources.md)
> Estado: draft
> Última revisión: 2026-11-14

## Flujo

```
scraper/scrape.py ──► data/raw/<source>/*  + data/manifest.csv (source,url,path,sha256,bytes,fetched_at)
        │                     │ (sync manual)
        │                     ▼
        │              S3 raw/<source>/   (inmutable)
        ▼
pipeline/build_*.py ──► derived/{weather,soil,obs,parcel,catalog}/  ──► S3 derived/  ──► backend/app/data/
```

- `scraper/`: con red; idempotente (no repite descargas); un conector por fuente en `scraper/sites/`.
- `pipeline/`: con red solo si consulta servicios (SDA); idempotente; registra en cada salida `source`, `retrieved_at`, `sha256` del insumo.
- Backend: sin red; solo `derived/`.

## Salidas `derived/` (contrato de archivos)

| Archivo | Contenido | Consumidor |
|---|---|---|
| `weather/power_daily_<site>.csv` | Columnas canónicas de `WeatherDay` en unidades de [glossary](../00-overview/glossary.md) | `RealWeatherProvider` |
| `soil/<parcel_id>.json` | `SoilProfile` | `RealSoilProvider` |
| `obs/ndvi_modis_<parcel_id>.csv` | `date, ndvi, qa_flag` (media de píxeles en la parcela) | `RealObservationProvider` |
| `obs/smap_<site>.csv` | `date, soil_moisture` (m³/m³) | `RealObservationProvider` |
| `parcel/<parcel_id>.geojson` | Polígono + historial CDL 2021–2024 | Mapa, `farms/analyze` |
| `catalog/catalog_v1.json` | Catálogo verificado | `RealCropCatalogProvider` |
| `nass/county_yields.csv` | Rendimiento por condado y año | Backtest (modelo 17), fuera del motor |

## Deuda técnica y pendientes del recolector

| # | Hallazgo | Impacto | Acción propuesta | Fase |
|---|---|---|---|---|
| a | Sentinel-2/Landsat: `sortby datetime desc` + `max_items: 6` → solo las últimas escenas de may–sep 2024 | Serie truncada a fin de temporada; no sirve para fenología | Ordenar ascendente o paginar todo el rango; filtrar nubes con SCL | F4 |
| b | POWER solo 2023–2024 (rango global `area.start/end`) | Sin climatología para SPI, anomalías, años análogos, Monte Carlo | Rango propio por fuente (`"start"` en la fuente); POWER desde 1981 | F2 |
| c | SSURGO solo baja zips | Sin AWC/textura/drenaje para el balance hídrico | Extraer tablas (`chorizon`, `component`, `muaggatt`) o consultar Soil Data Access por polígono (verificar endpoint y campos) | F3 |
| d | bbox 10×10 km ≠ parcela | El gemelo necesita una unidad de manejo | Definir parcela piloto con CDL 2021–2024 (píxeles con rotación corn/soy consistente) | F3 |
| e | MODIS NDVI: 46 imágenes cubren los 2 años | Serie de sincronización más segura | Usarla como observación principal en F4 | F4 |
| f | ECOSTRESS, GEDI, ERA5, LANDFIRE | Costosos o sin probar | Fuera del MVP | — |
| g | `power_daily.csv` aún no está disponible en el repo/equipo | Bloquea F2 | Sintético mientras tanto (ADR-004) | F2 |
| h | Unidades de radiación de POWER AG sin confirmar | ET0 errónea si se asume mal | Verificar en doc oficial/cabecera del CSV antes de convertir | F2 |

## Reglas

- Nunca editar `data/raw/` a mano; todo cambio pasa por script.
- Cada `build_*.py` documenta insumos (paths del manifest) y es reproducible.
- Valores faltantes de POWER (centinela de faltante en el CSV; verificar valor) → `NaN` + `warnings`, nunca 0.
- Almacenamiento y permisos: [storage-s3](../04-data/storage-s3.md).

Builder: Opus para SSURGO/SDA y arreglos STAC; Sonnet para `build_weather` y exportaciones simples.
