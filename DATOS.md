# AGROX · Capa de datos

Cómo conseguimos, limpiamos y servimos los datos de NASA y sus socios que alimentan AGROX.

> **En una frase:** construimos la tubería que lleva datos reales de satélite, clima y suelo, de 25 fuentes oficiales, hasta el gemelo digital de la parcela. Parte se procesa por lotes y parte se pide en vivo a las APIs, para cualquier punto del mundo.

---

## 1. El problema

El reto *Field Shift* pide ayudar a agricultores a elegir rotaciones de cultivo usando observaciones de la Tierra. Para eso hacen falta datos de clima, suelo, vegetación, agua y mercado. Vienen de muchas agencias, en formatos distintos y, en algunos casos, en archivos de cientos de MB que cubren el planeta entero.

**Nuestro objetivo:** que la app tenga los mejores datos posibles, verificados, ligeros y con su origen siempre visible.

---

## 2. Qué construimos

```
 APIs oficiales (NASA, USDA, ESA, FAO, ISRIC)
        │
        ├── A. Recolector por lotes ──► data/raw ──► pipeline ──► derived/ ──┐
        │      (zona piloto, Iowa)                                           ├──► Gemelo digital (backend)
        ├── B. Consulta por punto (cualquier lugar del mundo, ~10 s) ────────┤
        │                                                                    │
        └── C. Clima en vivo del gemelo (NASA POWER 1984-hoy) ───────────────┘
```

### A. Recolector por lotes (`scraper/`)

- **25 fuentes del reto** con un conector cada una: SMAP, GPM/IMERG, Landsat, MODIS, NASA POWER, SRTM, ECOSTRESS, GEDI, NLDAS/GLDAS, Sentinel-2, ERA5, CropScape (CDL), SSURGO/Web Soil Survey, PRISM, NLCD, NAIP, GAEZ, CoCoRaHS, NWIS, NASS, AMS Market News, OpenET, LANDFIRE y Ag Data Commons.
- **Recorte en origen:** las imágenes y productos globales se piden ya recortados a la zona, con Planetary Computer y NASA Harmony. Por ejemplo, SMAP bajó de **658 MB a 1.4 MB por día**: el total es ~2.5 GB en vez de más de 25 GB.
- **Trazabilidad:** cada archivo queda registrado en `data/manifest.csv` con su URL de origen, fecha, tamaño y huella sha256.
- **Robustez:** si falla una fuente, las demás siguen. Las llaves van en `.env` y nunca se suben a git.
- **Datos compartidos:** los datos crudos están en un bucket del equipo, para que nadie tenga que volver a descargarlos.

### B. Consulta global por punto (`scraper/punto.py`)

Se elige cualquier lat/lon del planeta y en **~10 segundos** se obtiene:

| Qué responde | Fuente | Resolución |
|---|---|---|
| ¿Es campo de cultivo? ¿Lo fue cada año de 2017 a 2023? | ESA WorldCover + Impact Observatory LULC | 10 m |
| Elevación y pendiente (riesgo de erosión) | Copernicus DEM | 30 m |
| Suelo: textura, pH, carbono, nitrógeno, de 0 a 30 cm | SoilGrids (ISRIC) | 250 m |
| Clima diario + normales de 30 años | NASA POWER | ~50 km |
| Serie de NDVI sin nubes (cuándo crece el cultivo, cosechas por año) | Sentinel-2 | 10 m |
| Aptitud de 20 cultivos de rotación, con y sin riego | FAO GAEZ v4 | ~9 km |

Lo probamos en **Iowa, Mato Grosso (Brasil), Punjab (India) y Beauce (Francia)**, y los resultados coinciden con lo que se sabe de cada zona. Por ejemplo, en Punjab el trigo sale con aptitud 0 sin riego y 53 con riego, que es la realidad de esa región. Las fuentes se piden en paralelo y el resultado queda en caché, así que repetir un punto tarda 1 s.

### C. Gemelo digital en vivo (`AGROX_DATA_MODE=live`)

El gemelo pide sus datos **directo a la API de cada fuente**, con caché diaria y respaldo a los datos procesados si una API falla:

| Dato | Fuente en vivo | Qué se ganó |
|---|---|---|
| Clima | NASA POWER, **1984 a hoy (~43 años)** | Anomalía de lluvia y **SPI** (índice de sequía). La temporada de 2012 da **SPI −2.37 / −50.9 %**, la sequía histórica del Medio Oeste; la de 2024 da 0.1, un año normal |
| NDVI por zona | Sentinel-2 vía Planetary Computer, **2021 a hoy** | ~300 fechas sin nubes por zona, incluidos 2025 y 2026; ~36 s la primera vez del día |
| Suelo | SSURGO + **SoilGrids** (ISRIC) | Validación cruzada de la capacidad de agua: SSURGO 176 mm/m frente a SoilGrids 131 mm/m. Fuera de EE.UU. se usa SoilGrids, marcado como `ESTIMATED` |

**En cualquier lugar del mundo:** con `farm_id = pt_<lat>_<lon>` el gemelo arma una parcela de 36 ha con datos globales. Lo probamos en Veracruz, Mato Grosso, Punjab y Francia: la primavera de 2024 en Francia sale con **SPI 2.03 (+58.8 % de lluvia)**, una de las más lluviosas registradas, y Punjab con estrés hídrico alto para maíz sin riego.

En 2023–2024 el clima en vivo da **exactamente** los mismos datos que el pipeline, y hay una prueba que lo verifica.

---

## 3. Errores que encontramos y corregimos

| Problema | Impacto | Solución |
|---|---|---|
| Sentinel-2 suma +1000 a sus valores desde enero de 2022 (versión de procesamiento 04.00) | El NDVI salía aplastado o falso según el año | Corrección **escena por escena** según su versión. Ahora el pico de verano da 0.79–0.88 de forma consistente en 2021–2024 |
| La serie de Sentinel-2 solo tenía 6 fechas de fin de temporada | No servía para ver el ciclo del cultivo | Ahora son **131 escenas**: todas las temporadas mayo–sep de 2021 a 2024 |
| MODIS cubría solo 1 año | Historia corta | 2 años completos (89 compuestos) |
| El pipeline escribía rutas con `\` en Windows | Rompía la app en Linux | Rutas POSIX |
| SMAP bajaba archivos globales de 658 MB | 11 GB para 17 días | Recorte en el servidor de NASA (Harmony) |

---

## 4. Principios que seguimos

- **Nada inventado:** cada endpoint, código de clase y unidad se verificó en vivo contra la fuente oficial antes de usarlo.
- **Honestidad científica:** todo dato lleva su origen y su estado (`MEASURED`, `ESTIMATED`...). Si una fuente falla, se dice.
- **Ligero:** pedimos solo la zona que hace falta, nunca el planeta completo.
- **Probado:** 85 pruebas del backend en verde, más pruebas propias del recolector y del módulo por punto, todas sin depender de internet.

---

## 5. Límites conocidos (y por qué)

- **El historial de "qué se sembró" (CDL) solo existe en EE.UU.** Fuera de EE.UU. la rotación actual se deduce del NDVI o la declara el agricultor.
- **SMAP, ECOSTRESS, IMERG y GEDI no van en vivo:** tardan minutos por pedido. Se usan por lotes.
- **ERA5** quedó en la cola de Copernicus. No es indispensable, porque POWER y PRISM cubren el clima.
- **GRACE/GRACE-FO (agua subterránea)** está pendiente. El reto lo menciona y es el siguiente paso.
- **La parcela del gemelo sigue saliendo de CDL** (solo EE.UU.). Para usarlo en cualquier lugar, el agricultor tendría que dibujar su parcela; clima, NDVI y suelo ya funcionan en vivo.

---

## 6. Cómo usarlo

```bash
pip install -r requirements.txt
python scraper/scrape.py                    # bajar datos de la zona piloto
python scraper/punto.py 30.80 75.55         # cualquier punto del mundo
AGROX_DATA_MODE=live make dev               # app con clima en vivo de NASA POWER
```

Detalle técnico: `README.md`, `docs/04-data/sources.md` y `docs/02-modules/data-pipeline.md`.
Pull requests: #2 (recolector), #6 (consulta global), #7 (corrección de NDVI), #8 (clima en vivo) y el de NDVI, suelo y SPI en vivo.
