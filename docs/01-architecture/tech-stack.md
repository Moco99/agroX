# Tech stack

> TL;DR: Backend FastAPI + Pydantic + pandas/NumPy; frontend React + Vite + TS strict + Leaflet + R3F + Recharts; persistencia JSON versionado (+SQLite opcional).
> Depende de: nada.
> Estado: draft
> Última revisión: 2026-11-14

Razón de FastAPI en vez de NestJS: ADR-002 en [decisions](../00-overview/decisions.md).

## Backend (`backend/`)

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | Python ≥ 3.10 (igual que `scraper/`) | Ecosistema científico. |
| API | FastAPI | Validación + OpenAPI automática. |
| Contratos | Pydantic v2 | Validación en todos los bordes. |
| Cálculo | pandas, NumPy (SciPy si hace falta: Savitzky-Golay, ajustes) | Series diarias y estadística. |
| HTTP saliente | HTTPX | Solo en scripts de ingesta, nunca en el motor. |
| Ráster (ingesta) | rasterio / xarray (TBD al implementar F3/F4) | Leer GeoTIFF/HDF recortados. |
| Tests | pytest | Unidad, contrato, golden. |
| Lint/format | ruff (+ ruff format) | Un solo tool, rápido. |
| Tipado | mypy (modo strict en `engine/`) | Motor sin `Any`. |

## Frontend (`frontend/`)

| Capa | Elección | Motivo |
|---|---|---|
| Build | Vite | Arranque rápido. |
| UI | React + TypeScript strict | Estándar del equipo. |
| Estilos | Tailwind | Estándar Velantex. |
| Mapa | Leaflet (react-leaflet) | Selección de parcela, capas, overlay NDVI como imagen (MapLibre descartado salvo O-12). |
| 3D | `three` + `@react-three/fiber` + `@react-three/drei` | Diorama procedural, cámara ortográfica, `Html` para etiquetas (ADR-009; Streamlit descartado). |
| Globo (stretch) | `three-globe` (opcional) | Pantalla S1; ver [digital-farm-3d](../02-modules/digital-farm-3d.md). |
| Tokens / tema | `src/styles/tokens.ts` → Tailwind | Tema oscuro ([design-tokens](../07-design/design-tokens.md)). |
| i18n | Diccionario plano `src/i18n/es.ts` (es-MX), sin librería en MVP | Copy centralizado y revisable. |
| Gráficas | Recharts | Series y comparaciones. |
| Estado | Zustand o React Context (decisión abierta O-10) | Sincroniza 2D, ranking y 3D. |
| Tests | Vitest + Testing Library; Playwright e2e (smoke de la demo) | |

## Persistencia

- **JSON versionado** para catálogo (`catalog_v1`), parcelas de demo y `derived/` (ver [storage-s3](../04-data/storage-s3.md)).
- **SQLite opcional** solo si hace falta caché/consultas; no es requisito del MVP.
- Sin base de datos de servidor en el hackathon.

## IA

- Copilot: Claude vía API (opcional). Plantillas deterministas de respaldo. Ver [ai-copilot](../02-modules/ai-copilot.md).

## Despliegue

| Parte | Destino | Estado |
|---|---|---|
| Frontend | Vercel | Decidido. |
| Backend | TBD (O-5 en [decisions](../00-overview/decisions.md)) | Abierto. |
| Datos | Empaquetados con el backend (`derived/`); sin red en la demo | Decidido. |

Dominios Velantex (convención): `agrox.velantex.dev` / `agrox.api.velantex.dev` (propuesta, confirmar).

## Fuera del stack (no añadir sin ADR)

Bases de datos de servidor, colas, microservicios, ML en el motor, autenticación (no hay usuarios en el MVP).
