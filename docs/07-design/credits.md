# Créditos y atribuciones de imágenes

> TL;DR: Fuentes de las imágenes del globo y del mapa (NASA GIBS, Esri World Imagery, mosaico sin conexión, NAIP, Sentinel-2), textos de atribución exactos que muestra la app y pendientes legales antes de un despliegue público.
> Depende de: —
> Estado: draft
> Última revisión: 2026-11-14

La atribución de las teselas activas se muestra siempre en la esquina inferior derecha del mapa (control de atribución de MapLibre) y el resumen está en Ayuda («?» de la barra superior). Decisiones: ADR-022 y ADR-023 en [decisions](../00-overview/decisions.md).

## Globo y mapa (frontend)

| Uso | Fuente | Licencia / términos | Texto mostrado |
|---|---|---|---|
| Zoom bajo (0–6.5) | NASA Earth Observatory **Blue Marble Next Generation** vía **NASA GIBS** (WMTS `epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8`, niveles 0–8, sin clave) | Dominio público (imágenes NASA); NASA pide citar la fuente | `Imagery: NASA Earth Observatory Blue Marble NG via NASA GIBS (public domain)` |
| Zoom alto (4.5–19) | **Esri World Imagery** (`services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer`) | Términos de Esri (ArcGIS Online / Esri Master License Agreement); uso con atribución | `Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` |
| Sin conexión | Mosaico `frontend/public/textures/earth/blue-marble-mercator-2k.jpg` (2048×2048 px, Web Mercator, 447 kB), cosido de las 64 teselas de nivel 3 de GIBS Blue Marble NG | Dominio público (NASA) | misma línea que GIBS |

**Pendiente antes de un despliegue público o comercial:** verificar los términos de uso de Esri World Imagery (límites de uso, si exige cuenta/clave de ArcGIS Location Platform y requisitos de atribución vigentes). El proveedor de alto zoom se puede cambiar sin tocar código con `VITE_SATELLITE_TILE_URL` y `VITE_SATELLITE_ATTRIBUTION`; una clave publicada por Vite debe ser pública y restringida por dominio, nunca un secreto.

## Granja piloto (backend)

| Uso | Fuente | Licencia |
|---|---|---|
| Ortofoto de la granja (`/api/imagery/basemap`; también respaldo sin conexión en el mapa) | USDA **NAIP** | Dominio público (USDA FPAC) |
| NDVI por fecha (`/api/imagery/ndvi`) | **Copernicus Sentinel-2** L2A | Licencia abierta Copernicus; «Contains modified Copernicus Sentinel data» |
| Relieve del gemelo | NASADEM / SRTM 30 m | Dominio público (NASA) |

## Software

MapLibre GL JS (BSD-3-Clause), three.js (MIT), React Three Fiber / drei (MIT).

Las texturas del antiguo globo three.js (`earth-*.jpg`) se retiraron junto con esa escena.
