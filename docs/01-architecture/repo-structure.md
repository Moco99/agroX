# Estructura del repo

> TL;DR: Monorepo simple: `scraper/` (existe), `backend/` y `frontend/` (por crear), `data/` fuera de git, `docs/` en rama docs.
> Depende de: [system-architecture](system-architecture.md)
> Estado: draft (las carpetas `backend/` y `frontend/` son propuesta hasta F0)
> Última revisión: 2026-11-14

## Árbol objetivo

```
agroX/
  README.md                 # guía del recolector (existe)
  requirements.txt          # deps del scraper (existe)
  .env.example              # nombres de variables, sin valores (existe)
  scraper/                  # recolector de datos (existe, en main)
    scrape.py               # orquestador: sources.json → data/raw/<id>/ + manifest.csv
    sources.json            # área (bbox, fechas, condado) + fuentes
    common.py               # Skip, load_env, center
    sites/<id>.py           # un conector por fuente o hook compartido (stac, harmony, earthdata)
    test_scrape.py
  pipeline/                 # (nuevo) raw → derived; scripts idempotentes, con red permitida
    build_weather.py
    build_soil.py
    build_ndvi.py
    build_parcel.py
  backend/
    pyproject.toml
    app/
      main.py               # crea FastAPI, monta routers
      api/                  # routers (sin lógica)
        health.py  climate.py  crops.py  farms.py  rotations.py  scenarios.py  twin.py  copilot.py
      schemas/              # modelos Pydantic = contrato (ver data-contracts)
      services/             # orquestación por caso de uso
      engine/               # PURO: sin I/O
        twin/  climate/  rotation/  scenarios/  scoring/
      providers/
        ports.py            # Protocols: WeatherProvider, SoilProvider, ...
        factory.py          # elige Synthetic*/Real* por entorno
        synthetic/          # SyntheticWeatherProvider, ...
        real/               # RealWeatherProvider, ...
      data/                 # derived empaquetado para la demo (pequeño, versionado o descargado en build)
    tests/
      unit/  contract/  golden/  api/
  frontend/
    package.json  vite.config.ts  tsconfig.json
    src/
      app-shell/            # sidebar, top-bar, layer-bar, timeline, synthetic-banner
      screens/              # globe-exploration/ (stretch)  parcel-ndvi/  digital-twin/
      components/  services/  types/  store/  map/  charts/
      scene/                # R3F diorama (+ globe/ stretch), see digital-farm-3d
      styles/tokens.ts      # design tokens (see docs/07-design)
      i18n/es.ts            # es-MX UI copy dictionary
  data/                     # FUERA de git (.gitignore): raw/, manifest.csv
  docs/                     # esta documentación (07-design/: ui-spec, tokens, mockups/*.jpg)
```

## Reglas

- `data/` nunca entra en git (ya está en `.gitignore`). Tampoco `.env`.
- `backend/app/data/` contiene solo `derived/` pequeño (MB). Si pasa de ~20 MB, se descarga en build desde S3 en vez de commitearse (ver [storage-s3](../04-data/storage-s3.md)).
- `engine/` no importa de `providers/`, `services/`, `api/` ni de `fastapi`. Un test lo verifica (ver [testing-strategy](../05-development/testing-strategy.md)).
- Los tipos TS del frontend en `src/types/` reflejan `schemas/` (generados desde OpenAPI o escritos a mano; si se escriben a mano, test de contrato contra fixtures JSON).
- Archivos TS/web en kebab-case; módulos Python en snake_case ([conventions](../05-development/conventions.md)).

## Relación con el scraper

`scraper/` sigue como está (ya fusionado). `pipeline/` lee `data/raw/` y escribe `derived/`. El backend nunca importa `scraper/`.
