# agroX

## Gemelo digital: ejecución local

Requisitos: [uv](https://docs.astral.sh/uv/), Node 20+ y pnpm 10.

```bash
make setup   # venv Python (uv) + dependencias del frontend (pnpm) + derived/ si falta
make dev     # backend http://127.0.0.1:8000/api/health  ·  frontend http://127.0.0.1:5173  (Ctrl+C detiene ambos)
```

- Datos: `backend/app/data/derived/` (derivados pequeños versionados) se genera desde `data/raw/` con `make derived`.
- Modo sintético: `AGROX_DATA_MODE=synthetic make dev` (la UI muestra el banner "Datos sintéticos").
- Modo en vivo: `AGROX_DATA_MODE=live make dev`. El clima se pide directo a la API de NASA POWER (1984 a hoy, ~43 años; 3 s la primera vez, luego caché en `data/cache/`). Activa la anomalía de lluvia (necesita ≥ 10 años). Si POWER no responde, usa `derived/` y lo avisa. Parcela, suelo y NDVI siguen saliendo de `derived/`.
- Calidad: `make test` (pytest), `make lint` (ruff, mypy, tsc), `make build` (frontend).
- Simulación exploratoria: no predice rendimiento; parámetros de cultivo provisionales (`verified=false`). Decisiones en `docs/00-overview/decisions.md` (ADR-012..020).

### Recorrido visual y datos remotos

La entrada muestra la Tierra completa (globo MapLibre con atmósfera, giro lento hasta que interactúas). Puedes arrastrar y acercarte sin saltos hasta campos individuales en cualquier lugar. Un clic selecciona un punto y «Consultar este punto» (o `⌘K`) lo analiza mediante FastAPI. «Visitar piloto de Iowa» vuela a la granja piloto (polígono, 4 zonas, NDVI por fecha) y desde ahí se abre el gemelo 3D; acercarte manualmente sobre el piloto también entra a la vista de granja. Los enlaces `?stage=globe`, `?stage=map` y `?stage=twin` abren cada vista; se respeta la preferencia de movimiento reducido.

Para leer datos remotos, configura estas variables en `.env` (no versionado):

```dotenv
AGROX_S3_BUCKET=<your-bucket>
AWS_PROFILE=<your-read-only-profile>
AWS_REGION=us-east-1
AGROX_DATA_SOURCE=auto
```

`make dev` carga esas variables. El backend usa la cadena de credenciales de AWS y lecturas parciales con caché local; el navegador consume la API y nunca recibe credenciales. No hace falta descargar el bucket. `auto` permite recurrir al espejo local; `s3` exige acceso remoto. Los derivados empaquetados permiten consultar el piloto sin reconstruir los datos crudos.

El relieve y las imágenes conservan su procedencia. Los cultivos y elementos decorativos del 3D son ilustrativos; las simulaciones no predicen rendimiento.


## App global: datos de cualquier punto del mundo

La app funciona así: el usuario hace clic en cualquier lugar del mapa y en ~10 segundos tiene
todo lo necesario para recomendar una rotación de cultivos. No se guarda el mundo: se pide en vivo
solo ese punto, y se guarda en caché para que la segunda vez sea instantánea.

```bash
python scraper/punto.py 30.80 75.55                        # últimos 2 años
python scraper/punto.py 30.80 75.55 2023-01-01 2024-12-31  # periodo a elegir
```

Desde el backend de la app:

```python
from punto import consultar
datos = consultar(lat, lon)   # dict listo para mandar como JSON al mapa
```

| Sección | Qué responde | Fuente (global, sin llave) | Resolución |
|---|---|---|---|
| `cobertura` | ¿Es campo de cultivo? ¿Lo fue cada año 2017-2023? Avisa si el clic cayó en ciudad, bosque o agua | ESA WorldCover 2021 + Impact Observatory LULC anual | 10 m |
| `terreno` | Elevación y pendiente (riesgo de erosión) | Copernicus DEM | 30 m |
| `suelo` | Arcilla, arena, limo, pH, carbono orgánico, nitrógeno, CIC y densidad a 0-5, 5-15 y 15-30 cm | SoilGrids (ISRIC) | 250 m |
| `clima` | Serie diaria (temperatura, lluvia, humedad, radiación, humedad del suelo) + normales de 30 años | NASA POWER | ~50 km |
| `vegetacion` | NDVI de cada pasada de Sentinel-2 sin nubes: muestra cuándo crece el cultivo, cuántas cosechas hay al año y cuándo el suelo queda desnudo | ESA Sentinel-2 L2A | 10 m |
| `aptitud` | Índice 0-100 para 20 cultivos de rotación (cereales, leguminosas, oleaginosas), **sin riego y con riego** | FAO GAEZ v4 | ~9 km |

Probado en Iowa, Mato Grosso (Brasil), Punjab (India) y Beauce (Francia): 9-12 s por punto nuevo, 1 s si ya se consultó.
Si una fuente falla, las demás llegan igual y la sección trae `"error"`.

### Cómo recomendaría la app una rotación (propuesta)

1. **Filtrar:** si `cobertura.es_cultivo` es falso, avisar y no recomendar.
2. **Candidatos:** cultivos con `aptitud` alta (temporal o con riego, según el agricultor).
3. **Ajustar por suelo:** pH, textura y carbono descartan o premian cultivos (p. ej. leguminosas fijan nitrógeno si `nitrogeno_g_kg` es bajo).
4. **Ajustar por terreno:** con pendiente alta, priorizar cultivos de cobertura que frenan la erosión.
5. **Leer la serie de NDVI:** cuántas cosechas hay al año y en qué meses, para encajar la rotación en las temporadas reales.
6. **Clima:** las normales de 30 años y la serie reciente detectan sequías, heladas y calor.
7. **Explicar:** cada recomendación dice qué dato la justifica y de qué fuente sale.

### Qué no va en vivo y por qué

SMAP, ECOSTRESS, IMERG, NLDAS/GLDAS, GEDI y ERA5 tardan minutos por pedido o pesan cientos de MB por archivo.
Sirven para análisis por lotes con `scraper/scrape.py` (abajo), no para responder un clic.
La humedad del suelo y la lluvia en vivo salen de NASA POWER.
CDL, SSURGO, PRISM, NASS y similares solo cubren EE.UU.; en la app global los reemplazan WorldCover/LULC, SoilGrids y POWER.

## Recolector por lotes (zona fija)

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
| `sentinel2` | ESA Sentinel-2 | Rojo, infrarrojo y máscara de nubes: todas las escenas con <10% de nubes de cada temporada may-sep 2021-2024 (~110), recortadas | Planetary Computer (STAC) | ✅ |
| `landsat` | Landsat 8/9 | Rojo, infrarrojo y temperatura, may-sep 2024, recortadas | Planetary Computer | ✅ |
| `modis_ndvi` | MODIS | NDVI cada 16 días, 250 m, Terra y Aqua, 2023-2024 completos | Planetary Computer | ✅ |
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

### Consultar un punto desde la aplicación

La búsqueda por coordenadas consulta fuentes históricas bajo demanda; no son mediciones en tiempo real. Ejecuta `make setup` tras actualizar para instalar `requests`, y `make dev` para levantar ambos servicios.

```bash
curl -X POST http://127.0.0.1:8000/api/points/query \
  -H 'Content-Type: application/json' \
  -d '{"lat":30.8,"lon":75.55,"start":"2023-01-01","end":"2024-12-31","refresh":false}'
```

Cada sección identifica su fuente, estado y errores independientes. Una fuente caída no sustituye datos con cifras inventadas. El primer resultado puede tardar alrededor de 90 segundos más la finalización de solicitudes pendientes; repetir una consulta completa usa la caché local durante 24 horas. Los intervalos admiten un máximo de 730 días de diferencia.

### Globo y zoom satelital

MapLibre carga imágenes por teselas al acercarse: NASA Blue Marble (GIBS, dominio público) en zoom bajo y Esri World Imagery en zoom alto (fundido cruzado entre zoom 4.5 y 6.5, máx. 19). Rueda, doble clic y gestos táctiles permiten explorar; un clic selecciona coordenadas para analizarlas. El detalle de campos depende de la imagen disponible y no incluye polígonos de parcelas globales. La imagen base no representa necesariamente la fecha del análisis NDVI.

Las teselas requieren conexión; sin red aparece un aviso, un mosaico Blue Marble reducido incluido en la app y, en el piloto, la ortofoto NAIP del backend. Créditos y pendiente de términos de Esri: `docs/07-design/credits.md`. Para cambiar la fuente de zoom alto Para otra fuente compatible configura `frontend/.env.local` y reinicia Vite:

```dotenv
VITE_SATELLITE_TILE_URL=https://your-provider.example/tiles/{z}/{x}/{y}.jpg
VITE_SATELLITE_ATTRIBUTION=Your imagery provider
```

Las variables `VITE_*` son públicas en el navegador: no introducir secretos de AWS. Conserva la atribución exigida por tu proveedor.
