# UI spec: layout y pantallas

> TL;DR: Descripción en texto de los 3 mockups (globo, parcela con NDVI, gemelo digital 3D), mapeo elemento de UI → módulo → dato → `data_state` → prioridad, y la brecha honesta entre mockup y capacidad real. Leer esto basta; abrir las imágenes es opcional.
> Depende de: [data-contracts](../01-architecture/data-contracts.md)
> Estado: draft (endpoints marcados PROPUESTA siguen a [data-contracts](../01-architecture/data-contracts.md))
> Última revisión: 2026-11-15

Los mockups son **referencia visual ilustrativa** (ADR-010 en [decisions](../00-overview/decisions.md)): mandan las reglas de honestidad, no los números de las imágenes. Colores y escala NDVI: [design-tokens](design-tokens.md). Escena 3D: [digital-farm-3d](../02-modules/digital-farm-3d.md).

| Mockup | Archivo |
|---|---|
| S1 Exploración (globo) | [01-globe-exploration.jpg](mockups/01-globe-exploration.jpg) |
| S2 Parcela con NDVI | [02-parcel-ndvi.jpg](mockups/02-parcel-ndvi.jpg) |
| S3 Gemelo digital | [03-digital-twin.jpg](mockups/03-digital-twin.jpg) |

## Layout compartido (app shell)

| Zona | Contenido | Notas |
|---|---|---|
| Barra lateral izq. (~250 px) | Logo AGROX; menú: Exploración, Vegetación, Clima, Rotaciones, Escenarios, Informes; separador; tarjeta "AGROX AI · Análisis y recomendaciones" | Ítem activo con fondo verde tenue; iconos de línea |
| Barra superior | Búsqueda "Buscar ubicación, establecimiento o área…" con atajo ⌘K; selector de rango de fechas; selector "Capas (n)"; notificaciones; ayuda; avatar | En MVP la búsqueda solo resuelve la parcela piloto (stretch: geocoding) |
| Zona central | Lienzo (globo / mapa / escena 3D) con controles flotantes a la izquierda: zoom +/−, ubicarme, pantalla completa; barra de escala | Controles en DOM, encima del lienzo |
| Panel derecho (~470 px) | Tarjeta con título, subtítulo de ubicación, pestañas y bloques de KPI | Scroll propio |
| Barra inferior | "Capas activas (n)" con casillas + reproductor (play, línea de tiempo con hitos, fecha, ◀ ▶) | Fecha sincronizada con el store |
| Aviso de datos | Banner "Datos sintéticos — no representan la parcela real" ([synthetic-data](../04-data/synthetic-data.md)) | **Obligatorio**, no aparece en mockups |

Tema oscuro predominante (ADR-011). Copy en es-MX centralizado en `frontend/src/i18n/es.ts` (propuesta): ningún texto de UI suelto en componentes.

## Menú → módulo → vista del dossier

| Menú | Módulo(s) | Vista dossier (1–5) | Pantalla |
|---|---|---|---|
| Exploración | `earth_scanner`, `digital_farm` | 1 Workspace | S1 (stretch) → S2 |
| Vegetación | `twin` (NDVI observado vs simulado), `digital_farm` | 2 Earth Scanner (pestaña vegetación) | S2 con capa NDVI |
| Clima | `earth_scanner` | 2 Earth Scanner | Panel de indicadores + gráficas |
| Rotaciones | `rotation`, `crop_catalog` | 3 Rotaciones | Pestaña Rotación de S2/S3 |
| Escenarios | `what_if`, `twin`, `digital_farm` | 4 Farm 3D | S3 |
| Informes | todos (solo lectura) | 5 Informe | F5 |
| Tarjeta AGROX AI | `copilot` (opcional) | transversal | Cajas "Análisis…/Explicación de AGROX AI" |

## S1 · Exploración (globo) — stretch

Globo 3D sobre fondo estelar ocupa el centro. Panel "Análisis de región" con selector de región; 4 KPI (NDVI prom., Precipitación mm, Temperatura °C, Radiación solar MJ/m²) cada uno con delta ▲/▼ y referencia ("vs. período anterior" / "vs. promedio histórico"); gráfica de área "Evolución del NDVI" con selector "Últimos 6 meses" y tooltip; "Compatibilidad de cultivos" con barras horizontales por cultivo y chevron. Barra inferior de capas: NDVI, Precipitación, Temperatura, Límites + reproductor. Opciones técnicas del globo: [digital-farm-3d](../02-modules/digital-farm-3d.md).

## S2 · Parcela con NDVI (MVP)

Stepper superior: 1 Ubicación → 2 Granja → 3 Análisis (✓ en pasos completos). Mapa satelital con polígono de la parcela (borde verde brillante), mapa de calor NDVI recortado al polígono, etiqueta flotante (nombre + ha), leyenda NDVI y escala. Alternador "Imagen satelital / NDVI". Panel derecho: nombre de granja, ubicación, área, botón Editar; pestañas Resumen/Cultivos/Rotación/Escenarios; "Estado de la vegetación (NDVI)" (valor + delta + mini-serie); "Condiciones recientes (prom. últimos 30 días)": temperatura, precipitación, radiación; caja "Análisis de la parcela" (texto AI con check); CTA "Ver recomendaciones de cultivo". Abajo: "Evolución del NDVI" con reproductor. Detalle: [earth-scanner](../02-modules/earth-scanner.md).

## S3 · Gemelo digital (MVP)

Pestañas del lienzo: Gemelo digital / Mapa 2D / Vista satelital; selector "Escenario: <preset>". Diorama isométrico low-poly de la granja en 4 zonas con etiquetas (zona, cultivo, ha, vigor NDVI), coloreadas rojo→verde por vigor; camino, casa, silo, estanque, árboles, aspersores; leyenda "Vigor vegetal (NDVI)", rosa de los vientos y escala. Panel derecho "Gemelo digital de la granja": pestañas Resumen/Cultivos/Escenario/Rotación; "Condiciones de simulación": sliders de reducción de precipitación y aumento de temperatura, segmentado "Nivel de riego" (Sin riego/Bajo/Medio/Alto), humedad del suelo prom., etapa del cultivo; 5 mosaicos KPI (NDVI, Temperatura, Precipitación, Humedad del suelo, Estrés esperado) con deltas; caja "Explicación de AGROX AI" con "Recomendación". Abajo: capas (NDVI, Humedad del suelo, Temperatura, Riego, Estrés hídrico) y línea de tiempo por etapas (Siembra, Desarrollo, Floración, Llenado, Cosecha) con reproductor. Detalle: [digital-farm-3d](../02-modules/digital-farm-3d.md), [what-if-scenarios](../02-modules/what-if-scenarios.md).

Implementado en el panel derecho: la tarjeta «Cultivo y fecha de siembra» tiene un selector de cultivo por zona (la simulación y el 3D se actualizan al cambiarlo), muestra la siembra que usó la última corrida con su `data_state` y permite declarar la fecha por cultivo. Un cultivo supuesto (sin declarar) también se dibuja en 3D, con la etiqueta «(supuesto, sin declarar)» e insignia `ESTIMATED`; antes de la siembra la zona muestra suelo sin cultivo y lo indica en su etiqueta. La tarjeta «Periodo de simulación» muestra la cobertura climática de la parcela (rango, días y huecos) y acepta fechas futuras solo con un año histórico de referencia (`reference_year`, ver [data-contracts](../01-architecture/data-contracts.md)); la corrida se etiqueta `SIMULATED` con el año usado. En corridas con año de referencia o con un ciclo de rotación («Simular ciclo N en 3D», cultivo `SIMULATED` que no reemplaza al declarado) el NDVI observado no se muestra sobre la simulación: la etiqueta dice «no aplica: simulación».

## Elemento de UI → dato

| Elemento | Pant. | Módulo | Endpoint / dato fuente | `data_state` | Prioridad |
|---|---|---|---|---|---|
| Shell (sidebar, topbar, rango de fechas, capas) | todas | — | store | — | MVP |
| Banner datos sintéticos | todas | — | `data_mode` de cada respuesta | SYNTHETIC | MVP |
| Globo + capas diarias | S1 | `digital_farm` | textura NASA + GIBS (verificar) | MEASURED (imagen) | stretch |
| KPI de región + deltas | S1 | `earth_scanner` | `GET /api/climate` | MEASURED / SYNTHETIC | stretch |
| Compatibilidad de cultivos | S1/S2 | `rotation` | `POST /api/rotations/recommend` (indicadores A/Ssuelo/C) | ESTIMATED / SYNTHETIC | stretch |
| Stepper Ubicación→Granja→Análisis | S2 | `digital_farm` | `POST /api/farms/analyze` + entradas `DECLARED` | DECLARED | MVP |
| Polígono de parcela y zonas | S2/S3 | `digital_farm` | `derived/parcel/<parcel_id>.geojson` | DECLARED | MVP |
| Overlay NDVI (mapa de calor) | S2 | `twin` (obs.) | `GET /api/observations/ndvi-overlay` (PROPUESTA) | MEASURED / SYNTHETIC | MVP (sintético) |
| Serie "Evolución del NDVI" | S1/S2 | `twin` | `GET /api/observations/ndvi` (PROPUESTA) | MEASURED / SYNTHETIC | MVP |
| Condiciones recientes 30 d | S2 | `earth_scanner` | `GET /api/climate` | MEASURED / SYNTHETIC | MVP |
| Caja "Análisis/Explicación de AGROX AI" | S2/S3 | `copilot` | `POST /api/copilot/explain` (modo `template`) | hereda de la entrada | MVP (template) |
| CTA recomendaciones / pestaña Rotación | S2/S3 | `rotation` | `POST /api/rotations/recommend` | ESTIMATED / SYNTHETIC | MVP |
| Diorama 3D por zonas | S3 | `digital_farm` | `POST /api/twin/simulate` (zonas, PROPUESTA) | SIMULATED / SYNTHETIC | MVP |
| Sliders precip./temp., preset | S3 | `what_if` | `POST /api/twin/simulate` `scenario` | SIMULATED | MVP |
| Nivel de riego | S3 | `what_if`, `twin` | `irrigation_level` (PROPUESTA) | DECLARED (entrada) | MVP |
| KPI humedad del suelo | S3 | `twin` | `TwinState.root_zone_depletion_mm` / `taw_mm` | ESTIMATED / SIMULATED | MVP |
| KPI estrés esperado | S3 | `twin` | `TwinState.ks` + umbrales (TBD) | SIMULATED | MVP |
| Timeline por etapas | S3 | `twin` | `TwinState.stage`, `gdd_cum` | ESTIMATED / SIMULATED | MVP |
| Capas Temperatura/Riego/Estrés en 3D | S3 | `digital_farm` | salidas por zona | SIMULATED | MVP (NDVI, estrés) · stretch (resto) |
| Búsqueda ⌘K, notificaciones, avatar | todas | — | — | — | stretch (placeholders inertes) |

Cada KPI muestra insignia `data_state` (MEASURED/ESTIMATED/SIMULATED/SYNTHETIC) junto al valor.

## Brecha mockup ↔ capacidad real

| # | Mockup | Realidad / regla |
|---|---|---|
| a | Argentina / Veracruz, globo | Piloto Iowa (ADR-001, pendiente O-1): textos y datos de demo usan la parcela piloto. |
| b | "Compatibilidad 92 %" | No es probabilidad: índice comparativo 0–100 ("92/100") con enlace a metodología y fuentes. |
| c | Texto de AGROX AI y "sorgo" | Solo resultados del motor ([ai-copilot](../02-modules/ai-copilot.md)); si `sorghum` no está en el catálogo ni lo rankea el motor, no se recomienda. |
| d | Timeline 1 ene–28 feb | Irreal para maíz/soya de Iowa: temporada real 2024 (may–sep) o calendario sintético etiquetado. |
| e | "Humedad del suelo 22 %" | POWER `GWETROOT`/`GWETTOP` son índices adimensionales 0–1 (verificar en doc de POWER); el gemelo da agua en suelo en mm. Mostrar uno, con unidad y etiqueta (O-13). |
| f | Mapa de calor NDVI fino | Requiere Sentinel-2/Landsat recortado (serie truncada, ver [data-pipeline](../02-modules/data-pipeline.md)) o MODIS 250 m (grueso): la leyenda declara resolución y fecha. |
| g | "Estrés esperado Medio-alto" | Requiere umbrales sobre `ks` en [model-specs](../03-models/model-specs.md) (TBD, O-16). |
| h | KPI sin procedencia | Insignia `data_state` en cada KPI; en F1 aviso visible "datos sintéticos". |
| i | Nivel de riego | Input nuevo del balance hídrico (`I_i`); mm aplicados por nivel = TBD (O-15). |
| j | 4 zonas con cultivos distintos | Gemelo **por zona**: cada zona = instancia con su cultivo y suelo; granja = lista de zonas; MVP 1–4 zonas. |
| k | Vigor NDVI que cambia con el escenario | El gemelo no simula NDVI: bajo escenario la capa por defecto del 3D es estrés hídrico (`ks`, SIMULATED); NDVI queda como último observado con su fecha. |

## Exploración cinematográfica

Las tres referencias se recorren como globo → mapa de parcela → gemelo. Se mantiene la carcasa oscura con acentos verdes y panel de indicadores a la derecha; en pantallas pequeñas el panel fluye debajo del visor. La ubicación es el piloto disponible en Iowa: los nombres, superficies, métricas y fechas de los mockups no se usan como datos. La ortofoto y el overlay NDVI comparten bounds, y las fechas seleccionadas se solicitan a la API.

## Consulta global por coordenadas

La búsqueda superior (`⌘K` / `Ctrl K`) abre un formulario de latitud, longitud y fechas (hasta 730 días), precargado con el punto elegido en el globo. Envía `POST /api/points/query`. El resultado se muestra como **capa superpuesta** sobre la etapa (el mapa sigue montado debajo y conserva cámara y teselas); `Esc` o «← Volver al mapa» la cierran y abortan la petición. Durante la consulta (~20 s la primera vez) hay estado de carga con cancelar; un reintento fuerza actualización. Los seis bloques muestran fuente y `data_state`; un error de una fuente no oculta las demás. Una nota indica si el punto está dentro del piloto (parcelas, NDVI por fecha y gemelo disponibles) o fuera (solo imagen satelital y consulta por punto).

## Globo y zoom continuo hasta escala de campo

**Etapa 1 · globo (`?stage=globe`, pantalla inicial).** Tierra completa en proyección globo (MapLibre) con atmósfera y fondo estelar; gira lentamente hasta la primera interacción (sin giro con `prefers-reduced-motion`). Rueda, pellizco o arrastre acercan sin saltos hasta campos individuales en cualquier lugar (zoom máx. 19). Imágenes por rango de zoom con fundido cruzado: NASA Blue Marble (GIBS) en zoom bajo → Esri World Imagery desde zoom 4.5–6.5 ([credits](credits.md)). Un chip muestra zoom, metros por píxel y fuente; la atribución y la escala están siempre visibles. Un pin «Piloto Iowa» marca la única zona con datos de parcela.

Panel derecho: punto seleccionado (clic en el globo → marcador, coordenadas, nota de cobertura, botón «Consultar este punto»), granja piloto («Visitar piloto de Iowa», «Abrir gemelo 3D»), «Explorar otros lugares» (Pampa húmeda, caña en Veracruz, Ciudad de México: solo imagen) e indicadores de temporada del piloto con `data_state`. Barra inferior: capas del piloto (NDVI, límites) y reproductor de escenas NDVI.

**Etapa 2 · granja (`?stage=map`).** «Visitar piloto de Iowa» (o el pin) vuela con `flyTo` ~4.6 s del globo a la granja; también se entra al acercarse manualmente sobre el piloto (zoom ≥ 12.5) y se sale al alejarse (zoom < 9 o a más de 25 km), sin cambiar de visor. Aparecen el polígono de la granja y las 4 zonas, el NDVI de la fecha elegida (`/api/imagery/ndvi`) con leyenda, el selector «Imagen satelital / NDVI», el stepper «1. Ubicación → 2. Granja → 3. Análisis», «← Volver al globo» y el CTA «Ver gemelo digital 3D». Panel: NDVI más reciente por zona (con fecha y `data_state`), condiciones de la temporada y nota de cobertura.

**Etapa 3 · gemelo (`?stage=twin`).** Fundido (450 ms + 700 ms) hacia la escena R3F; «← Volver al mapa de la granja» y el menú lateral regresan (el menú «Exploración» vuela de vuelta al globo).

**Sin conexión.** Si fallan las teselas (o el navegador reporta `offline`), aviso «Sin conexión: imágenes globales no disponibles» con reintento; queda un mosaico Blue Marble reducido incluido en la app y, en el piloto, la ortofoto NAIP servida por el backend. Nunca una pantalla vacía. Sin WebGL: aviso y la búsqueda por coordenadas sigue disponible.

Clima, Rotaciones e Informes siguen marcados «próximamente» (deshabilitados).

## Abrir cualquier parcela

Desde el globo, un clic elige un punto. Fuera del piloto, el panel muestra la parcela que se crearía (`pt_<lat>_<lon>`, redondeo a 2 decimales) y **«Abrir parcela aquí»**. La latitud válida es −60 a 75: fuera de ese rango el botón se desactiva y el panel explica que no hay cobertura de Sentinel-2 ni de relieve Copernicus utilizable. Si `/api/health` indica que el backend no está en modo `live` (o `any_parcel_supported=false`), el botón se desactiva con la nota «Reinícialo en modo vivo: `make dev-live` (o `AGROX_DATA_MODE=live make dev`)». Si la consulta de punto (`/api/points/query`) o la cobertura de uso de suelo de la parcela dicen que no es cultivo, se avisa («este punto no parece cultivo; los resultados pueden no servir») pero se permite continuar.

**Carga lenta (30–90 s la primera vez).** Al abrir, la cámara vuela al punto (`flyTo`) y el panel muestra una tarjeta de progreso con una fila por fuente (parcela y suelo, NDVI Sentinel-2, clima, imagen base, relieve, simulación), contador de segundos, botón **Cancelar** (aborta las peticiones), **Reintentar** y **Volver al piloto**. Cada fuente falla por separado con su mensaje; solo la parcela y la simulación son críticas. Un recurso que el backend no sirve para esa parcela (404/501) se marca «no disponible» y se usa el respaldo. Si el suelo es provisional (`ESTIMATED`, SoilGrids no respondió), el panel lo dice, ofrece «Reintentar suelo» y, cuando el backend publica `load_status.soil_final`, refresca solo.

**Etapa de granja para cualquier parcela (`?stage=map&farm=pt_…`).** Cuadrado de 36 ha y 4 zonas de 9 ha con etiquetas (cultivo declarado); NDVI como raster `/api/imagery/ndvi` cuando existe y, si no, como **color por zona** a partir de la serie Sentinel-2 real; reproductor con las fechas disponibles; panel con NDVI por zona (fecha y `data_state`), gráfica de la serie, clima del punto (NASA POWER), suelo con su estado, avisos colapsables (`farm.warnings`: «límite aproximado de 36 ha, no es un predio», cultivo declarado, suelo provisional) y el formulario de cultivo y siembra. El selector de temporada del piloto se sustituye por la ventana de simulación de la parcela.

**Declarar cultivo y fecha de siembra.** Por zona o para toda la parcela, con los cultivos de `GET /api/crops` (si el usuario necesita otro, el panel dice que aún no está soportado). La fecha de siembra es por cultivo y muestra una sugerencia `ESTIMATED` por hemisferio (la del backend si la da; si no, la ventana del catálogo desplazada seis meses al sur) que el usuario puede aceptar o cambiar. Lo declarado lleva la insignia `DECLARED`, se envía a `POST /api/twin/simulate` (`planting_dates`, `zone_crops`) y se guarda en `localStorage` por `farm_id`.

**Deep links.** `?farm=<id>` (piloto o `pt_*` válido; otro valor se ignora) y `?stage=`. El piloto es el valor por defecto y no escribe `farm`.

## Capa de interpretabilidad (lenguaje simple)

Regla de producto: una persona sin formación agronómica debe entender cada número sin salir de la pantalla. Todo el texto vive en `frontend/src/i18n/es.ts` (secciones `meaning`, `units`, `reading`, `formulas`, `glossary`, `dataStateHelp`, `modelNote`, `guide`).

| Pieza | Qué hace | Componente |
|---|---|---|
| KPI explicado | Valor + unidad abreviada **y escrita** ("% del agua útil del suelo (TAW)") + lectura con color, icono y palabra ("Agua disponible: 62 % — ✓ suficiente") + una frase de qué significa + insignia `data_state` | `components/explain/explained-metric.tsx` |
| Lectura bueno/atención/problema/referencia | Nunca solo color: icono (✓ ! ✕ •) y palabra | `components/explain/reading-chip.tsx`, `lib/readings.ts` |
| ¿Cómo se calcula? | Desplegable con pasos en palabras simples, fórmula de caja blanca, valores actuales sustituidos, datos de entrada y límites | `components/explain/how-calculated.tsx` |
| Glosario en contexto | Término subrayado con «?»: tooltip al pasar o enfocar (teclado/toque) para NDVI, ET0, Kc, GDD, SPI, Ks, TAW, RAW, AWC, EcoCrop… | `components/explain/term.tsx` |
| Nota de modelo transparente | "Modelo transparente, no caja negra": FAO-56 y grados-día, sin ML en el cálculo ni IA generativa en el texto; el puntaje es índice comparativo, no probabilidad ni rendimiento | `components/explain/model-note.tsx` |
| Leyenda `data_state` | Qué significa Medido/Declarado/Estimado/Simulado/Sintético; también como `title` de cada insignia | `components/explain/data-state-legend.tsx` |
| Guía rápida y glosario | Botón «Guía» en la barra superior (y en Ayuda): 4 pasos de uso, colores, `data_state`, glosario con búsqueda; `Esc` cierra | `app-shell/guide-panel.tsx` |
| Leyendas de capa | Rampa + clases NDVI + frase de significado + unidad escrita | `components/layer-legend.tsx` |

**Umbrales de las lecturas (sin cifras inventadas).**
- Agua disponible: "suficiente" si queda ≥ (1 − p) del TAW (Dr ≤ RAW, FAO-56; p del catálogo vía engine). Por debajo, la severidad sigue la clase de estrés del mismo día.
- Estrés: la clase del día es **orientativa**. Reutiliza los umbrales que el backend publica para el **Ks medio** (`stress_class_thresholds_mean_ks`, configuración de producto) aplicados a un Ks diario; la UI lo dice así en «¿Cómo se calcula?».
- NDVI: clases visuales de la rampa canónica (0.2/0.35/0.5/0.65/0.8) con tono **siempre neutral**. Las palabras describen el follaje, no lo juzgan: un NDVI bajo es normal antes de sembrar o tras cosechar.
- SPI: clases de McKee et al. (1993). Los tonos son una **decisión de producto**: normal = bien; seco moderado = atención; muy o extremadamente seco = problema; húmedo moderado = referencia; muy o extremadamente húmedo = atención (posible exceso de agua). El backend solo lo calcula con ≥ 30 años de referencia (`spi.MIN_YEARS`).
- Anomalía de lluvia: solo dirección (más/menos que lo usual); requiere ≥ 10 años.
- Índice de rotación: relativo a la mejor opción comparada; compatibilidades según el trapecio EcoCrop (100 dentro del óptimo, 0 fuera del rango tolerado).
- Temperatura y precipitación del gemelo: lectura neutral (sin umbral de cultivo en esta vista).

**Fórmulas fieles al código.**
- Grados-día del gemelo (`engine/phenology.py::daily_gdd`): método modificado cuando el cultivo trae `t_cap_gdd` (Tmáx limitada al tope y Tmín subida a la base); si no, promedio simple. Los grados-día del panel de Clima (`engine/indicators.py`) usan el promedio simple con la base fija que publica el backend. Son dos explicaciones distintas (`gddTwin` / `gddClimate`).
- El balance hídrico resta `ETc ajustada = Ks × Kc × ET0` (`engine/water_balance.py`).
- `frontend/src/lib/formulas.test.ts` fija estos textos contra el código del motor.

**Estados vacío / carga / error** dicen qué hacer (reintentar, ir a Exploración, cambiar fechas). Las explicaciones de "AGROX AI" son plantillas deterministas (`lib/explain.ts`) en lenguaje simple; usan `stress_day_ks` del backend cuando está disponible. Los IDs de metodología (`twin_v1`, `climate_v1`) se muestran como texto legible.
