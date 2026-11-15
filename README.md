# agroX

## Gemelo digital: ejecución local

Requisitos: [uv](https://docs.astral.sh/uv/), Node 20+ y pnpm 10.

```bash
make setup   # venv Python (uv) + dependencias del frontend (pnpm) + derived/ si falta
make dev     # backend http://127.0.0.1:8000/api/health  ·  frontend http://127.0.0.1:5173  (Ctrl+C detiene ambos)
```

- Datos: `backend/app/data/derived/` (versionado, ~170 KB) se genera desde `data/raw/` con `make derived`.
- Modo sintético: `AGROX_DATA_MODE=synthetic make dev` (la UI muestra el banner "Datos sintéticos").
- Calidad: `make test` (pytest), `make lint` (ruff, mypy, tsc), `make build` (frontend).
- Simulación exploratoria: no predice rendimiento; parámetros de cultivo provisionales (`verified=false`). Decisiones en `docs/00-overview/decisions.md` (ADR-012..020).


## Recolector de datos

### La idea en corto

Bajar "todo" de estas fuentes no es posible ni útil: Landsat, Sentinel-2 o SMAP suman petabytes de todo el planeta.
Por eso el recolector **pide solo un pedazo de mapa y un rango de fechas** (el "área", en `scraper/sources.json`)
y a cada fuente le pide los datos de ese pedazo.

Casi ninguna de estas fuentes es una página con enlaces para descargar. Son **APIs**: como una ventanilla
donde pides algo con un formato fijo ("dame la lluvia de este punto entre estas fechas") y te lo entregan.
Por eso cada fuente tiene un **conector** pequeño en `scraper/sites/` que sabe cómo pedirle a su ventanilla.

### Para el equipo: bajar los datos en tu compu

1. Clona el repo y entra a la carpeta:
   ```bash
   git clone https://github.com/Moco99/agroX.git
   cd agroX
   ```
2. Instala lo necesario (Python 3.10 o más nuevo):
   ```bash
   pip install -r requirements.txt
   ```
3. **Opcional, para las fuentes con llave:** copia `.env.example` como `.env` y pon tus llaves (ver "Llaves" abajo). Sin `.env` funcionan 14 fuentes.
4. Corre:
   ```bash
   python scraper/scrape.py
   ```

Cuánto pesa (zona de prueba): ~400 MB las fuentes sin llave y ~1 GB las de NASA con token (casi todo es ECOSTRESS). SMAP, IMERG y GEDI se recortan en los servidores de NASA (Harmony), así que bajan solo tu zona.
Si solo quieres algunas fuentes, pásale sus ids: `python scraper/scrape.py power cdl prism`.

Mi recomendación: que **una persona** baje todo y lo comparta (Drive, USB) en vez de que cada quien baje 25 GB.

### Cómo usarlo

```bash
python scraper/scrape.py                 # todas las fuentes
python scraper/scrape.py power cdl smap  # solo algunas
```

- Lo descargado queda en `data/raw/<fuente>/` y cada archivo se anota en `data/manifest.csv` (de dónde vino, cuándo, tamaño, huella sha256). `data/` no se sube a git.
- Si lo vuelves a correr, no repite lo que ya bajó.
- Si una fuente falla, avisa y sigue con las demás.

### Cambiar la zona o las fechas

Edita `"area"` en `scraper/sources.json`:

| Campo | Qué es |
|---|---|
| `bbox` | Rectángulo `[oeste, sur, este, norte]` en grados. Ahora: 10×10 km cerca de Ames, Iowa |
| `start`, `end` | Rango de fechas |
| `state`, `county_fips`, `county_name`, `ssurgo_area` | Estado y condado (para datos que vienen por condado) |

### Llaves (cuentas gratis)

Copia `.env.example` como `.env` y llena las que consigas. Sin llave, esa fuente se marca como **SALTADA** y lo demás sigue.

| Variable | Para | Dónde se saca |
|---|---|---|
| `EARTHDATA_TOKEN` | SMAP, IMERG, ECOSTRESS, VIIRS, NLDAS, GLDAS, GEDI | https://urs.earthdata.nasa.gov → Generate Token. Para IMERG, NLDAS y GLDAS además autoriza "NASA GESDISC DATA ARCHIVE" en https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ (si no, sale "EULA Acceptance Failure") |
| `NASS_API_KEY` | QuickStats | https://quickstats.nass.usda.gov/api |
| `AMS_API_KEY` | Market News | https://mymarketnews.ams.usda.gov |
| `CDS_API_KEY` | ERA5 (y aceptar la licencia del dataset en su página) | https://cds.climate.copernicus.eu |
| `OPENET_API_KEY` | OpenET (solo oeste de EE.UU.) | https://etdata.org |
| `LANDFIRE_EMAIL` | LANDFIRE (pide un correo, no cuenta) | — |

### Qué hace cada fuente

Estado al 14-nov-2026 con la zona de prueba: ✅ = descargado y revisado · 🔑 = listo, falta la llave · ⚠️ = escrito pero no probado de punta a punta.

| id | Fuente | Qué baja | Cómo | Estado |
|---|---|---|---|---|
| `power` | NASA POWER | Clima diario (temp., lluvia, radiación, humedad de suelo, heladas) en el centro del área | API | ✅ |
| `nwis` | USGS NWIS | Caudal diario y nivel freático del condado + estaciones | API | ✅ (no hay pozos con datos diarios en Story) |
| `cdl` | CropScape CDL | Mapa de qué cultivo hubo en cada pixel de 30 m, 2021-2024 | API | ✅ |
| `ssurgo` | SSURGO / STATSGO2 / Web Soil Survey | Base de suelos completa del condado y del estado (zips oficiales de WSS) | API + descarga | ✅ |
| `prism` | PRISM | Lluvia y temperatura mensual 4 km, EE.UU. continental | Servicio de descarga | ✅ |
| `cocorahs` | CoCoRaHS | Lluvia diaria de cada estación voluntaria del estado | Exportación CSV | ✅ |
| `nlcd` | USGS NLCD | Cobertura del suelo 2019 y 2021, recortada | WCS (servicio de mapas) | ✅ |
| `gaez` | FAO GAEZ v4 | Aptitud de 7 cultivos (maíz, soya, trigo, alfalfa, avena, centeno, sorgo), global | ArcGIS ImageServer | ✅ |
| `agdatacommons` | USDA Ag Data Commons | Tablas de estudios con "rotation", "cover crop", "soil health", "corn", "soybean" en el título | API de Figshare | ✅ |
| `sentinel2` | ESA Sentinel-2 | Bandas rojo, infrarrojo y máscara de nubes, may-sep 2024, recortadas | Planetary Computer (STAC) | ✅ |
| `landsat` | Landsat 8/9 | Rojo, infrarrojo y temperatura, may-sep 2024, recortadas | Planetary Computer | ✅ |
| `modis_ndvi` | MODIS | NDVI cada 16 días, 250 m | Planetary Computer | ✅ |
| `naip` | NAIP | Foto aérea ~1 m | Planetary Computer | ✅ |
| `srtm` | SRTM (NASADEM) | Elevación | Planetary Computer | ✅ |
| `smap` | SMAP | Humedad del suelo diaria 9 km, recortada al área (~1.4 MB/día en vez de 658 MB) | Harmony (NASA) | 🔑 ✅ |
| `imerg` | GPM IMERG | Lluvia mensual, recortada | Harmony (NASA) | 🔑 requiere autorizar GES DISC |
| `ecostress_lst`, `ecostress_et` | ECOSTRESS | Temperatura de superficie y evapotranspiración, 70 m | Earthdata | 🔑 ✅ |
| `viirs_ndvi` | VIIRS | Índices de vegetación 500 m | Earthdata | apagada: ~100 MB/archivo sin recorte; MODIS NDVI ya lo cubre |
| `nldas`, `gldas` | NLDAS / GLDAS | Clima y humedad de suelo modelados, mensual (~10-24 MB por mes) | Earthdata | 🔑 requiere autorizar GES DISC |
| `gedi` | GEDI L4A | Biomasa, solo los disparos dentro del área | Harmony (NASA) | 🔑 |
| `nass` | USDA NASS QuickStats | Rendimientos y superficie sembrada, condado y estado, desde 2000 | API | 🔑 ✅ probado con llave |
| `ams` | USDA AMS Market News | Precios del reporte 2850 (granos en Iowa) | API | 🔑 ✅ probado con llave |
| `era5` | ERA5 (Copernicus) | Temperatura, lluvia y humedad de suelo mensual, recortado | API por pedidos | 🔑 ⚠️ |
| `landfire` | LANDFIRE | Tipo, cobertura y altura de vegetación + pendiente | API por trabajos | 🔑 ⚠️ |
| `openet` | OpenET | Evapotranspiración mensual | API | apagada: no cubre Iowa (llave probada con un punto en California) |

Notas:
- **Sentinel-2** se baja del espejo gratuito de Microsoft Planetary Computer (mismos datos de ESA, sin cuenta), no de Copernicus Data Space.
- **Web Soil Survey** es la página para ver SSURGO; los datos son los mismos zips que baja `ssurgo`.
- **SRTM** viene como NASADEM, la versión reprocesada por NASA.
- **MODIS/VIIRS**: MODIS sale de Planetary Computer ya recortado; VIIRS está apagado porque Harmony no lo recorta.
- **Ahorro de datos:** todo lo que se puede se pide recortado al área en el servidor (Planetary Computer, Harmony, WCS de NLCD). Solo bajan archivos completos los que vienen así de origen: PRISM y CoCoRaHS (tablas chicas), GAEZ (global pero ~1 MB), SSURGO (zip del condado) y ECOSTRESS (tiles de pocos MB).
- Los rásteres de satélite se bajan **ya recortados** al área, así pesan KB o pocos MB en vez de cientos de MB.

### Agregar o cambiar una fuente

1. Agrega un bloque en `scraper/sources.json` con un `id`.
2. Si la fuente es una página con enlaces a archivos, con `"url"` basta (el recolector busca los `.csv`, `.zip`, etc.).
3. Si es una API, copia `scraper/sites/_plantilla.py` como `scraper/sites/<id>.py`. Si varias fuentes usan la misma API, comparten conector con `"hook"` (como `stac` y `earthdata`).

Pruebas: `python scraper/test_scrape.py`
