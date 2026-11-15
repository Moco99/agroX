# Guía de datos: cómo trabajar con los datos de AGROX

> **TL;DR:** hay tres formas de obtener datos. Para construir pantallas o el motor de rotaciones, usa la **API del backend** en modo `live`, que funciona en cualquier punto del mundo con `farm_id = pt_<lat>_<lon>`. Todo dato trae su fuente y su `data_state`. El cultivo y la fecha de siembra **los declara el usuario**: no existe un mapa global de cultivo por parcela.

---

## 1. Qué camino usar

| Si vas a… | Usa | Detalle |
|---|---|---|
| Construir UI, el Rotation Engine o What If | **API del backend** (`AGROX_DATA_MODE=live`) | §2 y §3 |
| Explorar un punto rápido, sin backend | `python scraper/punto.py LAT LON` | §4 |
| Regenerar `derived/` o analizar los archivos crudos de la zona piloto | `scraper/scrape.py` + `make derived` | §5 |

---

## 2. Arrancar el backend

```bash
make setup                      # una vez
AGROX_DATA_MODE=live make dev   # API en http://127.0.0.1:8000/api
```

| Modo | De dónde salen los datos | Cuándo usarlo |
|---|---|---|
| `real` (por defecto) | `backend/app/data/derived/`: parcela piloto en Iowa, sin red | Demo sin internet, pruebas |
| `live` | APIs de cada fuente, con caché diaria en `data/cache/` | **Desarrollo normal y cualquier lugar del mundo** |
| `synthetic` | Datos generados, marcados como `SYNTHETIC` | Probar UI sin datos reales |

Si una API falla en modo `live`, la parcela piloto usa `derived/` y lo avisa en `warnings`. **Una parcela fuera del piloto nunca recibe datos de otro lugar**: si POWER no responde, el endpoint da error.

---

## 3. Endpoints y qué devuelven

### Parcelas: piloto o cualquier punto

`farm_id` puede ser:
- **`story_pilot_farm`**: la parcela piloto en Iowa (CDL, SSURGO, 4 zonas de 36 ha).
- **`pt_<lat>_<lon>`** (solo en `live`): una parcela de **36 ha con 4 zonas de 9 ha** centrada en el punto. Por ejemplo `pt_18.83_-96.78` (Veracruz) o `pt_30.8_75.55` (Punjab). Latitud válida de −60 a 75.

| Endpoint | Para qué |
|---|---|
| `GET /api/farms/{farm_id}` | Parcela, zonas, suelo, terreno, NDVI más reciente, avisos |
| `GET /api/climate?start=&end=&lat=&lon=` | Serie diaria e indicadores: lluvia, temperatura, GDD, ET0, días de helada o calor, **anomalía** y **SPI**. Con `lat`/`lon` en `live` usa ese punto. Máximo 800 días por consulta |
| `GET /api/observations/ndvi?farm_id=&source=sentinel2` | NDVI por zona y fecha (Sentinel-2 10 m; en `live`, de 2021 a hoy) |
| `GET /api/observations/ndvi?source=modis_ndvi` | NDVI MODIS 250 m (solo la parcela piloto) |
| `GET /api/observations/soil-moisture` | SMAP 9 km (solo la parcela piloto; es contexto, no un sensor de campo) |
| `POST /api/twin/simulate` | Gemelo: balance hídrico y estrés por zona. Acepta `scenario` (lluvia y temperatura), `planting_dates` y `monte_carlo` |
| `GET /api/twin/state?farm_id=&day=` | Estado del gemelo en un día |
| `GET /api/crops` | Catálogo de cultivos (`verified=false`: parámetros por verificar) |
| `GET /api/health` | Modo activo, cobertura de clima, avisos |

**Primera carga de una parcela `pt_`:** 30–90 s (NDVI y SoilGrids). Después sale de la caché todo el día. **Antes de una demo, abre la parcela una vez.**

### Qué fuente hay detrás de cada dato

| Dato | Piloto Iowa | Cualquier punto (`pt_`) | Resolución |
|---|---|---|---|
| Clima diario | NASA POWER | NASA POWER en ese punto | ~50 km |
| Historia de clima | 1984–hoy (`live`) / 2023–2024 (`real`) | 1984–hoy | — |
| NDVI | Sentinel-2 + MODIS | Sentinel-2 | 10 m / 250 m |
| Suelo (capacidad de agua) | SSURGO, validado contra SoilGrids | SoilGrids (`ESTIMATED`) | campo / 250 m |
| Terreno (pendiente) | NASADEM | Copernicus DEM | 30 m |
| Humedad del suelo | SMAP + POWER | POWER (`gwet_root`, `gwet_top`) | 9 km / ~50 km |
| Cultivo por año | CDL 2021–2024 (`MEASURED`) | **Declarado** (`DECLARED`, maíz por defecto) | — |

---

## 4. Consulta rápida de un punto, sin backend

```bash
python scraper/punto.py 18.83 -96.78                        # últimos 2 años
python scraper/punto.py 18.83 -96.78 2021-01-01 2024-12-31  # periodo a elegir
```

Devuelve en ~10 s:
- **Cobertura:** si el punto es cultivo, año por año 2017–2023.
- **Terreno, suelo y clima** (incluidas las normales de 30 años).
- **NDVI de Sentinel-2.**
- **Aptitud de 20 cultivos con y sin riego** (FAO GAEZ), útil para el Rotation Engine.

Desde Python: `from punto import consultar`.

**Revisa `cobertura.es_cultivo`:** si el punto cae en ciudad o bosque, el resultado no sirve para rotaciones. Ejemplo real: 18.88, −96.93 cae en la ciudad de Córdoba, Veracruz; 18.83, −96.78 sí es campo.

---

## 5. Datos crudos de la zona piloto

```bash
pip install -r requirements.txt
python scraper/scrape.py              # 25 fuentes -> data/raw/<fuente>/ + data/manifest.csv
make derived                          # data/raw -> backend/app/data/derived
```

- **Llaves:** van en `.env` (copia de `.env.example`). Nunca se suben al repo ni se pegan en chats o issues.
- **Datos ya descargados:** existe una copia en el almacenamiento del equipo. Pide acceso de **solo lectura** a quien lo administra; el nombre del bucket no va en el repo, porque es público.
- **Cobertura de cada fuente:** [sources](sources.md).

---

## 6. Reglas al usar estos datos

1. **Muestra siempre la fuente y el `data_state`:**
   - `MEASURED`: observado.
   - `ESTIMATED`: modelado o derivado.
   - `DECLARED`: lo dijo el usuario.
   - `SIMULATED`: escenario.
   - `SYNTHETIC`: falso para pruebas.
2. **No inventes cifras científicas** (Kc, temperaturas base, umbrales). Si falta una, escribe `TBD (verificar fuente: …)`.
3. **Lee los `warnings`** de cada respuesta y muéstralos: dicen qué falta o qué se supuso.
4. **El cultivo y la fecha de siembra los declara el usuario** fuera de EE.UU. Las fechas de siembra por defecto son del Medio Oeste de EE.UU.: pásalas en `planting_dates` para otras regiones o para el hemisferio sur.
5. **El índice no es una probabilidad:** un 80/100 no significa 80 % de éxito.

---

## 7. Límites conocidos

| Límite | Por qué | Cómo se maneja |
|---|---|---|
| No hay mapa global de qué cultivo hay en cada parcela | Solo CDL (EE.UU.) lo publica | Cultivo `DECLARED` |
| SoilGrids es lento y a veces no responde | Límite de ISRIC (~5 consultas/min) | Reintento; si no, 150 mm/m provisional `ESTIMATED` (sin caché) |
| SMAP, ECOSTRESS, IMERG y GEDI no van en vivo | Tardan minutos por pedido | Solo por lotes para la zona piloto |
| La parcela `pt_` es un cuadro, no un predio | No hay catastro global | Aviso en `farm.warnings` |
| GRACE (agua subterránea) no está | Pendiente | Ver §8 |

---

## 8. Pendientes (para quien tome el relevo)

| Tarea | Datos que ya tiene | Estado |
|---|---|---|
| **Rotation Engine** (`POST /api/rotations/recommend`, 3 estrategias con puntuación y explicación) | Clima, anomalía y SPI, suelo, terreno, NDVI, aptitud GAEZ (vía `punto.py`) | 🔴 Por hacer. Ver [rotation-engine](../02-modules/rotation-engine.md) |
| Frijol y un cultivo de cobertura en el catálogo | Aptitud GAEZ de frijol disponible | 🔴 Faltan parámetros verificados |
| UI: elegir un punto en el mapa → `pt_<lat>_<lon>` | API lista | 🟡 Frontend |
| UI: declarar cultivo y fecha de siembra | `planting_dates` ya existe | 🟡 Frontend |
| Periodos de suelo desnudo a partir del NDVI | ~150–300 fechas de NDVI por zona (según nubosidad; 158 medidas en el piloto) | 🟡 Cálculo pendiente |
| GRACE / GRACE-FO | — | ⚪ Opcional |
