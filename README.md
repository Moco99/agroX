# AGROX

**Gemelo digital hídrico-fenológico de una parcela agrícola, con comparación de rotaciones de cultivos y datos abiertos de NASA y otras fuentes públicas.**

> *English, in short:* AGROX is an open-source web prototype that builds a transparent (white-box) digital twin of a farm plot from open satellite, climate and soil data, compares crop rotations with a comparative index, and shows the result on a map and in an illustrative 3D view. Born at NASA Space Apps 2026. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). The UI and docs are in Spanish (es-MX); code, identifiers and commits are in English.

AGROX nació como prototipo del hackathon NASA Space Apps 2026. Dibujas (o seleccionas) una parcela en cualquier lugar del mundo y la app:

- **Reúne datos reales** de la zona: clima (NASA POWER), vegetación (NDVI de Sentinel-2), terreno (Copernicus DEM) y suelo (SSURGO donde existe, SoilGrids en el resto).
- **Simula el agua y el desarrollo del cultivo** día a día con un modelo de proceso transparente (balance hídrico FAO-56 y grados-día), por zona de la parcela.
- **Compara rotaciones** con un índice comparativo basado en EcoCrop (temperatura, lluvia, pH) y en criterios de rotación (familia botánica, leguminosas, diversidad).
- **Explica cada número** en español sencillo: qué significa, cómo se calcula y de dónde sale el dato.
- **Muestra la parcela** en un globo/mapa satelital y en un gemelo 3D ilustrativo (Three.js).

## Honestidad científica

Estas reglas son parte del producto, no un descargo de responsabilidad:

- Todo valor que se muestra lleva su origen en `data_state`: `MEASURED`, `DECLARED`, `ESTIMATED`, `SIMULATED` o `SYNTHETIC`.
- El puntaje de rotación es un **índice comparativo**, no una probabilidad. **AGROX no predice rendimiento.**
- El motor es de **caja blanca**: modelos de proceso y reglas, sin ML dentro del cálculo (ver ADR-005 en [`docs/00-overview/decisions.md`](docs/00-overview/decisions.md)).
- El 3D es **ilustrativo**; los cultivos y elementos decorativos no son una medición.
- Los parámetros de cultivo aún no verificados se marcan como pendientes (`verified=false`, `TBD (verificar fuente: ...)`). No inventes cifras científicas: cita la fuente.

## Empezar

Requisitos: [uv](https://docs.astral.sh/uv/), Node 20+ y pnpm 10 (Python 3.10+ lo gestiona `uv`).

```bash
git clone https://github.com/Moco99/agroX.git
cd agroX

make setup     # venv de Python + dependencias del frontend + datos derivados si faltan
make dev       # backend en :8000 y frontend en :5173 (Ctrl+C detiene ambos)
```

Abre http://localhost:5173. La API está en http://localhost:8000 (documentación interactiva en `/docs`).

| Comando | Qué hace |
|---|---|
| `make dev` | Levanta la app con los datos derivados incluidos en el repo (parcela piloto de Iowa). |
| `make dev-live` | Igual, pero consulta las fuentes en vivo y permite abrir **cualquier parcela del mundo**. La primera consulta de un lugar nuevo tarda entre 20 y 90 s. |
| `AGROX_DATA_MODE=synthetic make dev` | Datos sintéticos etiquetados `SYNTHETIC`, sin red. |
| `make test` | Pruebas de backend (pytest) y frontend (Vitest). |
| `make lint` | ruff, mypy y `tsc`. |
| `make build` | Build de producción del frontend. |

No necesitas llaves ni cuentas para correr la app. Solo el recolector por lotes (`scraper/`) usa llaves opcionales de NASA Earthdata, USDA y otros: ver [`.env.example`](.env.example) y [la guía operativa](docs/04-data/scraper-and-live-data.md).

## Cómo está organizado

```
backend/    FastAPI + Pydantic v2. Capas: router → service → engine (puro) → provider
frontend/   React + Vite + TypeScript estricto, MapLibre GL, React Three Fiber, Recharts
pipeline/   Construye los datos derivados pequeños que se versionan
scraper/    Recolector por lotes de ~26 fuentes abiertas (opcional)
docs/       Contexto, decisiones (ADR), contratos de API y especificación de modelos
```

El **engine** es puro: sin red, sin I/O y sin aleatoriedad global. Los datos entran por puertos (`WeatherProvider`, `SoilProvider`, …) con adaptadores reales y sintéticos, lo que permite probar todo sin red.

## Documentación

Empieza por [`docs/README.md`](docs/README.md) y [`docs/navigation.yaml`](docs/navigation.yaml): indican qué leer según lo que vayas a hacer.

- [Decisiones de arquitectura (ADR)](docs/00-overview/decisions.md)
- [Arquitectura del sistema](docs/01-architecture/system-architecture.md) y [contratos de API](docs/01-architecture/data-contracts.md)
- [Especificación de modelos](docs/03-models/model-specs.md) (ecuaciones, entradas, unidades)
- [Guía de datos](docs/04-data/data-guide.md) y [fuentes](docs/04-data/sources.md)
- [Convenciones de código](docs/05-development/conventions.md)

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un PR. Algunas ideas por dónde empezar:

- Verificar parámetros de cultivo marcados como pendientes contra fuentes citables.
- Probar la app en regiones fuera de EE.UU. y reportar fechas de siembra y datos de suelo que no encajen.
- Mejorar la accesibilidad y las traducciones de la interfaz.
- Más pruebas del motor y de los adaptadores de datos.

## Datos y créditos

AGROX usa datos de NASA (POWER, GIBS), ESA Sentinel-2 vía Microsoft Planetary Computer, Copernicus DEM, ISRIC SoilGrids, USDA (SSURGO, CDL, NASS), FAO (EcoCrop, GAEZ) y teselas de Esri World Imagery, entre otras. Cada fuente tiene sus propios términos; las atribuciones exactas están en [`docs/07-design/credits.md`](docs/07-design/credits.md). Revisa ahí los términos de las imágenes antes de un despliegue público.

## Licencia

Pendiente de definir por los mantenedores. Hasta que exista un archivo `LICENSE`, el código no tiene una licencia de uso explícita.
