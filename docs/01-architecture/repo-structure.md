# Estructura del repo

> TL;DR: Monorepo simple: `scraper/`, `pipeline/` (raw→derived), `backend/` (FastAPI) y `frontend/` (Vite+R3F), `Makefile` raíz; `data/` fuera de git.
> Depende de: [system-architecture](system-architecture.md)
> Estado: draft (árbol real de la rama `feat/virtual-twin`)
> Última revisión: 2026-11-14

## Árbol real

```
agroX/
  Makefile                  # make setup | dev | derived | test | lint | build | clean
  scripts/dev.sh            # backend :8000 + frontend :5173, cierre limpio con Ctrl+C
  README.md  requirements.txt  .env.example
  scraper/                  # recolector (sin cambios): sources.json → data/raw/<id>/
  pipeline/                 # raw → derived, idempotente y SIN red (python -m pipeline.build_all)
    common.py               # rutas, bbox piloto, rampa NDVI, manifest
    build_catalog.py  build_weather.py  build_parcel.py  build_terrain.py
    build_soil.py  build_ndvi.py  build_smap.py  build_all.py
  backend/
    pyproject.toml  uv.lock # uv; grupos dev (pytest, ruff, mypy) y pipeline (rasterio, netCDF4…)
    app/
      main.py               # crea FastAPI, CORS, mapea errores (404/422)
      config.py             # AGROX_DATA_MODE=real|synthetic|live, AGROX_DERIVED_DIR, AGROX_SYNTHETIC_SEED, AGROX_CACHE_DIR
      api/routes.py  deps.py            # routers sin lógica
      schemas/              # contrato Pydantic (common, weather, soil, crops, farm, observations, climate, twin)
      services/             # climate_service, farm_service, twin_service, errors
      engine/               # PURO (mypy --strict): et0, water_balance, phenology, twin, scenarios,
                            #   indicators, compare, monte_carlo, config (supuestos de producto)
      providers/
        ports.py            # Protocols: Weather/Soil/CropCatalog/Farm/ObservationProvider
        factory.py          # elige Real*/Live*/Synthetic* por AGROX_DATA_MODE (cae a sintético con aviso)
        real/               # leen derived/
        synthetic/          # generadores con seed (params.py = "synthetic, not scientific")
      data/derived/         # ~170 KB versionado: weather, parcel, soil, terrain, obs, catalog, manifest.json
    tests/
      unit/  contract/  golden/(data/*.json)  api/
  frontend/
    package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  index.html
    src/
      app.tsx  main.tsx
      app-shell/            # sidebar, top-bar, data-banner, layer-bar, timeline
      screens/digital-twin/ # S3: pantalla, panel de simulación, KPI, gráficas, explicación por plantillas
      screens/parcel-ndvi/  # S2: overlay Sentinel-2 + zonas + series MODIS
      scene/                # R3F: farm-diorama, zone-field (InstancedMesh), props
      components/           # farm-map-2d (SVG, fallback sin WebGL), badges, leyenda, error-boundary
      services/api.ts  types/(api.ts, guards.ts)  store/twin-store.ts  lib/(derive, geo, explain, webgl)
      styles/(tokens.ts, global.css)  i18n/es.ts
  data/                     # FUERA de git: raw/, manifest.csv
  docs/
```

## Reglas

- `data/` nunca entra en git (ya está en `.gitignore`). Tampoco `.env`.
- `backend/app/data/` contiene solo `derived/` pequeño (hoy ~170 KB, versionado; ADR-020). Si pasa de ~20 MB, se descarga en build desde S3 en vez de commitearse (ver [storage-s3](../04-data/storage-s3.md)).
- `engine/` no importa de `providers/`, `services/`, `api/` ni de `fastapi`. Un test lo verifica (ver [testing-strategy](../05-development/testing-strategy.md)).
- Los tipos TS del frontend en `src/types/api.ts` reflejan `schemas/` (escritos a mano) y `types/guards.ts` valida cada respuesta (`unknown` → tipo) en el borde.
- Archivos TS/web en kebab-case; módulos Python en snake_case ([conventions](../05-development/conventions.md)).

## Relación con el scraper

`scraper/` sigue como está (ya fusionado). `pipeline/` lee `data/raw/` y escribe `derived/`. El backend nunca importa `scraper/`.
