# Fuentes de datos

> TL;DR: Las fuentes del recolector (26; 27 ids porque ECOSTRESS tiene dos), su estado, qué módulo las usa y si entran al MVP. Detalle operativo (cómo correr, llaves) en el README raíz.
> Depende de: nada.
> Estado: draft (estado de fuentes al 2026-11-14, según README del scraper)
> Última revisión: 2026-11-14

Config: `scraper/sources.json` (área: bbox `[-93.55, 41.95, -93.43, 42.04]`, Story County IA, FIPS 19169, `IA169`, 2023-01-01..2024-12-31). Guía de uso y obtención de llaves: `README.md` raíz.

Leyenda estado: ✅ descargado y revisado · 🔑 requiere llave (variable de entorno) · ⚠️ escrito, no probado · ⛔ apagada.

## Sin llave

| id | Fuente | Qué aporta | Estado | Uso en AGROX | MVP |
|---|---|---|---|---|---|
| `power` | NASA POWER (AG, diario) | T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, WS2M, GWETROOT, GWETTOP, FROST_DAYS | ✅ | Clima del gemelo y Earth Scanner | **Sí (base)** |
| `nwis` | USGS NWIS | Caudal y nivel freático del condado | ✅ (sin pozos diarios en Story) | Contexto | No |
| `cdl` | CropScape CDL 2021–2024 | Cultivo por píxel 30 m | ✅ | Parcela piloto + historial de rotación | **Sí** |
| `ssurgo` | SSURGO / STATSGO2 | Suelos (zips) | ✅ (falta extraer propiedades) | AWC, textura, drenaje → `SoilProfile` | **Sí** |
| `prism` | PRISM mensual 4 km | ppt, tmean | ✅ | Validación cruzada de clima | Opcional |
| `cocorahs` | CoCoRaHS | Lluvia diaria de voluntarios | ✅ | Validación de precipitación | Opcional |
| `nlcd` | NLCD 2019/2021 | Cobertura del suelo | ✅ | Capa de mapa | Opcional |
| `gaez` | FAO GAEZ v4 | Aptitud de 7 cultivos | ✅ | Contexto de aptitud | Opcional |
| `agdatacommons` | USDA Ag Data Commons | Tablas de estudios (rotación, coberturas) | ✅ | Fuentes para el catálogo | Opcional |
| `sentinel2` | Sentinel-2 L2A (Planetary Computer) | B04, B08, SCL, may–sep 2024 | ✅ (serie truncada) | NDVI 10 m | F4 |
| `landsat` | Landsat 8/9 L2 | red, nir08, lwir11 | ✅ (serie truncada) | NDVI/LST | Opcional |
| `modis_ndvi` | MODIS 13Q1 | NDVI 16 d, 250 m, 46 imágenes | ✅ | **Observación principal del gemelo** | **Sí (F4)** |
| `naip` | NAIP | Foto aérea ~1 m | ✅ | Fondo visual del mapa | Opcional |
| `srtm` | NASADEM | Elevación | ✅ | Pendiente (modelo 11), γ por elevación | **Sí** |

## Con llave Earthdata (`EARTHDATA_TOKEN`)

| id | Fuente | Estado | Uso | MVP |
|---|---|---|---|---|
| `smap` | SMAP L3 SM_P_E (9 km, Harmony) | 🔑 ✅ | Contexto de humedad superficial | Sí (contexto) |
| `imerg` | GPM IMERG mensual | 🔑 (autorizar GES DISC) | Validación de lluvia | Opcional |
| `ecostress_lst`, `ecostress_et` | ECOSTRESS 70 m | 🔑 ✅ | — | **No** |
| `nldas`, `gldas` | NLDAS / GLDAS mensual | 🔑 (autorizar GES DISC) | Contraste de humedad modelada | Opcional |
| `gedi` | GEDI L4A biomasa | 🔑 | — | **No** |
| `viirs_ndvi` | VIIRS VI | ⛔ (MODIS lo cubre) | — | No |

## Otras llaves

| id | Fuente | Variable | Estado | Uso | MVP |
|---|---|---|---|---|---|
| `nass` | USDA NASS QuickStats (desde 2000) | `NASS_API_KEY` | 🔑 ✅ | Backtest (modelo 17), contexto | F5 |
| `ams` | USDA AMS Market News (reporte 2850) | `AMS_API_KEY` | 🔑 ✅ | Contexto de precios (no entra al score) | No |
| `era5` | ERA5 mensual | `CDS_API_KEY` | 🔑 ⚠️ | — | **No** |
| `landfire` | LANDFIRE | `LANDFIRE_EMAIL` | 🔑 ⚠️ | — | **No** |
| `openet` | OpenET | `OPENET_API_KEY` | ⛔ (no cubre Iowa) | — | No |

## Volumen

- Zona de prueba según README: ~400 MB sin llave + ~1 GB con token (casi todo ECOSTRESS).
- Un integrante tiene ~30 GB descargados; se subirán a S3 `raw/`. En local se usan ~2 GB. Ver [storage-s3](storage-s3.md).

## Reglas

- No afirmar capacidades de una fuente sin verificarlas (p. ej. si ofrece API, resolución exacta, latencia).
- Cada dato expuesto cita su `source` (id de esta tabla o nombre oficial).
- Deuda técnica por fuente: [data-pipeline](../02-modules/data-pipeline.md).
