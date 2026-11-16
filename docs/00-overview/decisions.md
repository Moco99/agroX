# Decisiones (ADRs)

> TL;DR: Registro de decisiones de arquitectura (ADR-001..020) y lista de decisiones abiertas. Gana sobre cualquier otro doc.
> Depende de: [project-brief](project-brief.md)
> Estado: draft
> Última revisión: 2026-11-14

Formato: Contexto · Decisión · Consecuencias · Estado. Nuevos ADRs: numeración consecutiva, los propone el HEAD (ver [agent-routing](../06-agents/agent-routing.md)).

## ADR-001 · Piloto en Story County, Iowa

- **Contexto:** el dossier proponía Veracruz (maíz–frijol). El recolector ya baja datos de Story County, Iowa, donde hay fuentes abiertas densas (CDL, SSURGO, NASS por condado) y rotación maíz–soya.
- **Decisión:** piloto = bbox de ~10×10 km cerca de Ames, Iowa; maíz, soya y una cobertura. Veracruz pasa a "región futura".
- **Consecuencias:** crop ids y fuentes de EE.UU.; la demo y el pitch deben decir "piloto Iowa".
- **Estado:** **pendiente de confirmación explícita del equipo.**

## ADR-002 · Backend FastAPI (no NestJS)

- **Contexto:** el stack habitual de Velantex es NestJS. El núcleo es cálculo científico (series diarias, ET0, balance hídrico, estadística).
- **Decisión:** FastAPI + Pydantic + pandas/NumPy (del dossier). Python sigue PEP 8 (módulos snake_case).
- **Consecuencias:** acceso directo al ecosistema científico (pandas, NumPy, SciPy, rasterio). Convenciones adaptadas en [conventions](../05-development/conventions.md). Detalle en [tech-stack](../01-architecture/tech-stack.md).
- **Estado:** aceptada.

## ADR-003 · Definición de gemelo digital

- **Contexto:** "gemelo digital" se usa a la ligera; el jurado puede cuestionarlo.
- **Decisión:** "gemelo digital hídrico-fenológico de parcela" = (1) estado diario (agua en suelo, etapa, estrés), (2) sincronización con clima real (POWER) y contraste con observaciones (NDVI MODIS/Sentinel-2, SMAP), (3) simulación por bifurcación del estado. Niveles: modelo < sombra < gemelo. En 36 h: comparar simulado vs observado y mostrar discrepancia; nudging/Kalman = stretch. No predice rendimiento; el 3D es ilustrativo.
- **Consecuencias:** el gemelo es obligatorio y es el núcleo; la API expone `twin_level` honesto.
- **Estado:** aceptada.

## ADR-004 · Sintético primero

- **Contexto:** los datos reales llegan por partes (falta `power_daily.csv`, SSURGO sin parsear).
- **Decisión:** el gemelo se construye primero con datos sintéticos. Motor puro y determinista; entradas por puertos con adaptadores `Synthetic*` y `Real*`, contratos Pydantic idénticos, tests de contrato comunes, `data_state = SYNTHETIC` y aviso visible en UI.
- **Consecuencias:** UI y motor avanzan en paralelo con la ingesta. Checklist de sustitución en [roadmap](../05-development/roadmap.md).
- **Estado:** aceptada.

## ADR-005 · Modelos de proceso sobre ML

- **Contexto:** no hay datos de entrenamiento por parcela; el jurado valora explicabilidad.
- **Decisión:** núcleo con modelos de proceso (FAO-56, GDD) y reglas/multicriterio. ML solo como contraste de plausibilidad (backtest con NASS), nunca dentro del motor. LLM solo redacta.
- **Consecuencias:** ver [models-catalog](../03-models/models-catalog.md).
- **Estado:** aceptada.

## ADR-006 · Almacenamiento S3 raw/derived

- **Contexto:** ~30 GB descargados en una máquina; solo ~2 GB útiles en local; repo público.
- **Decisión:** bucket privado con `raw/<source>/` (inmutable + manifest) y `derived/` (MB, lo que consume la app). Backend y demo no leen `raw/` ni dependen de red. IAM de mínimo privilegio.
- **Consecuencias:** ver [storage-s3](../04-data/storage-s3.md).
- **Estado:** aceptada.

## ADR-007 · Ruteo de modelos de IA

- **Decisión:** Fable 5.1 = HEAD (planificación, ADRs, honestidad científica, pitch); Opus 5.5 = núcleo científico, contratos y revisión de lógica; Sonnet 5.5 = UI, cableado, fixtures, tests rutinarios, docs. Revisor ≠ constructor y de nivel ≥ para lógica.
- **Consecuencias:** ver [agent-routing](../06-agents/agent-routing.md).
- **Estado:** aceptada.

## ADR-008 · IDs de cultivo en inglés

- **Decisión:** `crop_id` en snake_case inglés (`corn`, `soybean`, `cereal_rye`); la UI traduce a español. Sustituye a `maiz`/`frijol` del dossier.
- **Estado:** aceptada (decisión del agente de docs, revisable por HEAD).

## ADR-009 · Three.js (React Three Fiber + drei) para el 3D; Streamlit descartado para el producto

- **Contexto:** se propuso Streamlit para el frontend. Los mockups ([ui-spec](../07-design/ui-spec.md)) piden un diorama 3D, sliders de simulación y reproductor de línea de tiempo sincronizados con mapa 2D y gráficas, dentro de un layout a medida (sidebar, paneles flotantes, barra de capas).
- **Decisión:** escena 3D con `three` + `@react-three/fiber` + `@react-three/drei` dentro de la app React + Vite + TS (ya fijada en [tech-stack](../01-architecture/tech-stack.md)). Streamlit no se usa para el producto.
- **Por qué no Streamlit:** (1) su modelo re-ejecuta el script de arriba abajo en cada interacción; `st.fragment` y caché lo mitigan, pero sigue siendo mala base para slider + reproductor que actualizan una escena en tiempo real; (2) no tiene grafo de escena 3D propio y su layout es de columnas/contenedores, no el shell de los mockups; (3) un Three.js dentro de Streamlit exige igualmente un componente custom en JS (históricamente en iframe), con lo que se pierde el store único 2D↔3D↔gráficas y se escribe React de todos modos.
- **Alternativas revisadas:** PyVista/stpyvista (visualización científica, no estilo diorama); pydeck/deck.gl (3D geoespacial de capas, no un diorama estilizado); CesiumJS (globo/terreno real, pesado para 36 h); Babylon.js (válido, sin ventaja frente a R3F con React ya decidido).
- **Consecuencias:** equipo TypeScript-first (Velantex) sin cambio de stack; spec en [digital-farm-3d](../02-modules/digital-farm-3d.md). Uso aceptable de Streamlit: panel **interno** opcional de exploración de datos/QA del pipeline, fuera del producto y de la demo.
- **Estado:** aceptada (revisable por HEAD).

## ADR-010 · Los mockups son referencia visual ilustrativa

- **Contexto:** los mockups muestran Argentina/Veracruz, cifras, porcentajes de "compatibilidad" y una recomendación de cultivo que el motor no produce.
- **Decisión:** los mockups fijan layout, jerarquía y estilo; **no** fijan datos, unidades ni afirmaciones. Ante conflicto prevalecen las reglas de honestidad (`DataState`, score ≠ probabilidad, 3D ilustrativo, AI solo redacta). Brecha detallada: [ui-spec](../07-design/ui-spec.md) → "Brecha mockup ↔ capacidad real".
- **Estado:** aceptada.

## ADR-011 · Tema oscuro predominante y escala NDVI canónica

- **Contexto:** el dossier tenía paleta clara; los mockups son oscuros y usan dos escalas NDVI distintas.
- **Decisión:** tema oscuro como predeterminado (paleta del dossier = alias de acento); una sola rampa NDVI rojo→amarillo→verde en todas las vistas. Valores: [design-tokens](../07-design/design-tokens.md).
- **Estado:** aceptada, **revisable** (paradas NDVI pendientes de validar con la fuente observacional usada en F4).

## ADR-012 · Frontend: pnpm + Zustand + SVG 2D sin teselas (cierra O-10, O-12, O-17)

- **Contexto:** la demo debe funcionar offline (sin CDN, teselas ni fuentes web) y compartir zona/capa/fecha/escenario entre diorama 3D, mapa 2D, KPI, gráficas y timeline.
- **Decisión:** pnpm 10 (lockfile versionado) y un store único Zustand (`frontend/src/store/twin-store.ts`). El "Mapa 2D" (fallback sin WebGL y pantalla S2) es un SVG proyectado localmente con el overlay PNG de Sentinel-2; **no** se usa Leaflet ni mapa base satelital (O-17 queda fuera del MVP). Tipografía del sistema. Sin Tailwind: CSS con variables que reflejan `styles/tokens.ts`.
- **Consecuencias:** cero llamadas de red en runtime salvo `/api` (proxy de Vite). Si más adelante se quiere mapa base, se agrega Leaflet con atribución.
- **Estado:** aceptada (D-TWIN-01).

## ADR-013 · Granja piloto y zonas desde CDL (cierra O-2, O-3)

- **Contexto:** hacía falta un polígono concreto con rotación maíz–soya real.
- **Decisión:** `pipeline/build_parcel.py` elige una ventana CDL de 40×40 px (1.2 × 1.2 km, 144 ha) dentro del bbox y del tile NASADEM, que maximiza la pureza mínima de sus 4 cuadrantes con mayoría 2024 mixta maíz/soya. Resultado: 4 zonas de 36 ha (NO y SO maíz 2024; NE y SE soya 2024) con alternancia limpia 2021–2024. Cultivo por año = mayoría CDL; el backend usa el historial CDL para simular 2023 con el cultivo de ese año. Cobertura del catálogo: `cereal_rye`.
- **Consecuencias:** el contorno es una ventana de píxeles, no un lindero catastral (se avisa en `warnings`). Las 4 zonas caen sobre el mismo componente SSURGO dominante (Canisteo, CL, AWC 176 mm/m, C/D): las zonas difieren por cultivo y pendiente, no por suelo.
- **Estado:** aceptada (D-TWIN-02).

## ADR-014 · Calidad de NASA POWER y unidades (cierra O-6; O-7 sigue abierta)

- **Contexto:** se sospechaban temperaturas de verano 2023 anómalamente frías.
- **Decisión:** revisión completa del archivo: sin `-999`, sin `T_max < T_min`, medias mensuales may–ago 2023 de 18–25 °C (coherentes con Iowa central). La sospecha venía de leer `DOY` como mes en las primeras filas (enero). Cada día lleva `qa_flags` (heurística `t_outlier` = |T − mediana móvil 15 d| > 12 °C; 1 día marcado: 2023-02-03, ola de frío real); **los valores no se modifican** y los flags viajan como `warnings`. Unidades confirmadas en la cabecera: radiación MJ m⁻² día⁻¹, viento m/s a 2 m, lluvia mm/día; GWETROOT/GWETTOP adimensionales 0–1 (solo contexto). Días con variables núcleo faltantes se omiten y se avisan.
- **Consecuencias:** con solo 2023–2024, SPI, anomalías de precipitación y años análogos **no se calculan** (la API devuelve `null` + aviso); requieren POWER desde 1981 (O-7).
- **Estado:** aceptada (D-TWIN-06).

## ADR-015 · Correcciones del balance hídrico (conservación de masa)

- **Contexto:** la auditoría del motor encontró pérdidas silenciosas de agua: (a) `Dr` se recortaba a TAW tras aplicar ETc_adj calculada con el Ks del inicio del día; (b) tras la cosecha la profundidad de raíz volvía a 0.15 m y el agua de las capas profundas desaparecía; (c) `fork` reanudaba con valores redondeados, así que un escenario neutro no reproducía `run_season`.
- **Decisión:** (a) ETc_adj se acota al agua disponible del día (`min(Ks·Kc·ET0, TAW − Dr + Pe + I)`), (b) después de la cosecha la capa seguida conserva la profundidad máxima (Kc de suelo desnudo), (c) el bucle diario devuelve su estado interno sin redondear. El riego de un escenario solo aplica al futuro bifurcado. Tests de conservación diaria y de temporada.
- **Consecuencias:** ΔDr = ETc_adj − Pe − I + DP se cumple día a día (tolerancia de redondeo); golden 2024 regenerado.
- **Estado:** aceptada (D-TWIN-03).

## ADR-016 · Suelo: límite radicular y nivel freático

- **Contexto:** SSURGO no reporta capa restrictiva para Canisteo y su nivel freático estacional mínimo es 15 cm (mal drenado, normalmente con drenaje entubado).
- **Decisión:** límite radicular = profundidad restrictiva si existe; si no, 1.5 m `DECLARED` (el máximo del cultivo, 1.2 m en maíz, es el que limita). No se modela ascenso capilar ni nivel freático; se asume drenaje entubado y se avisa en `warnings`. AWC = media ponderada 0–100 cm de `chorizon.awc_r`, `verified=false`.
- **Consecuencias:** el estrés simulado en suelos mal drenados puede sobrestimarse en años secos.
- **Estado:** aceptada (D-TWIN-04).

## ADR-017 · Nivel de gemelo honesto: sombra digital

- **Contexto:** la API compara NDVI MODIS/Sentinel-2 y SMAP con el estado simulado, pero no asimila observaciones ni cierra un lazo de decisión.
- **Decisión:** `twin_level = DIGITAL_SHADOW` con datos reales (aunque haya comparación) y `DIGITAL_MODEL` en modo sintético. `DIGITAL_TWIN` queda reservado a cuando exista nudging/asimilación.
- **Estado:** aceptada (D-TWIN-05).

## ADR-018 · Configuración de producto provisional (cierra O-13..O-16 para el MVP)

- **Contexto:** presets, láminas de riego, umbrales de estrés y fechas de siembra no son ciencia calibrada.
- **Decisión:** viven en `backend/app/engine/config.py` y se exponen en `GET /api/twin/config` para que la UI muestre sus supuestos: riego Bajo/Medio/Alto = 15/25/35 mm cuando el agotamiento supera 1.0/0.8/0.6 × RAW (máx. un evento por día); presets `baseline` (×1, +0 °C), `moderate_drought` (×0.6, +1.5 °C), `severe_drought` (×0.4, +3 °C), `wet_cool` (×1.3, −1 °C), `heat_wave` (×0.85, +3 °C); clases de estrés sobre Ks: ≥0.95 sin estrés, ≥0.85 bajo, ≥0.70 medio, resto alto; siembra maíz 5-may, soya 15-may (si la ventana empieza después de esa fecha y la contiene al año siguiente, se siembra al año siguiente); huecos de hasta 3 días en el año histórico de referencia se rellenan por interpolación lineal entre vecinos (`REFERENCE_MAX_FILL_DAYS`, marcados `reference_gap_filled`); escorrentía = fracción por grupo hidrológico de la lluvia > 5 mm. La humedad del suelo en UI es **agua del gemelo en % de TAW** (O-13); GWETROOT solo contexto. Kc, GDD y profundidades del catálogo son de literatura (FAO-56, convenciones de extensión) con `verified=false` y `data_state = ESTIMATED`.
- **Consecuencias:** toda cifra derivada lleva `ESTIMATED` (línea base) o `SIMULATED` (escenario). Cambiar estos valores es una decisión de producto, no un ajuste del modelo.
- **Estado:** aceptada, revisable con agrónomo.

## ADR-019 · Observaciones: alcance y calidad

- **Contexto:** los datos satelitales descargados tienen huecos de cobertura y calidad.
- **Decisión:** MODIS NDVI (escala 0.0001, relleno −3000 descartado; 1–2 píxeles de 250 m por zona; sin capa de fiabilidad) es la serie de temporada; Sentinel-2 (BOA offset −1000, escala 1/10000, máscara SCL 4/5/6) solo cubre 31-ago..30-sep-2024 y se usa para el overlay y la forma de senescencia (sin desfase de reverdecimiento). SMAP SPL3SMP_E: todas las retrievals de la celda tienen el bit 0 de calidad activo (no recomendada, típico con cultivo denso); se muestran como contexto regional y nunca alimentan el motor. El gemelo no simula NDVI: se compara la forma con el Kc normalizado.
- **Estado:** aceptada.

## ADR-020 · `derived/` versionado

- **Decisión:** `backend/app/data/derived/` pesa ~170 KB y se versiona; `make setup` solo lo regenera si falta (`make derived` fuerza). Así un clon sin `data/raw` arranca con datos reales; sin `derived/` el backend cae a sintético y lo avisa.
- **Estado:** aceptada.

## Decisiones abiertas

| # | Pregunta | Dueño | Bloquea |
|---|---|---|---|
| O-1 | Confirmar piloto Iowa (ADR-001) | Equipo | Pitch, catálogo |
| O-2 | ~~Parcela piloto~~ **cerrada: ADR-013** | HEAD + Opus | F3 |
| O-3 | ~~Cobertura~~ **cerrada: `cereal_rye` (ADR-013)** | HEAD | Catálogo |
| O-4 | Fuente de Kc y parámetros de cultivo (FAO-56 tablas vs extensión Iowa State) | Opus + HEAD | F3 |
| O-5 | Dónde y desde qué rama se despliega el backend (Railway/Render/otro) | Moco | F5 |
| O-6 | ~~Unidades de radiación~~ **cerrada: MJ m⁻² día⁻¹ (ADR-014)** | Opus | F2 |
| O-7 | Historia larga de POWER (desde 1981) para SPI/años análogos | Opus | F2 |
| O-8 | Definición operativa de A, Ssuelo, C (mapeo a 0–100) | HEAD + Opus | F1 |
| O-9 | Proveedor LLM y si el Copilot entra al MVP | HEAD | F5 |
| O-10 | ~~Zustand vs Context~~ **cerrada: Zustand (ADR-012)** | Sonnet (propone) | F1 |
| O-11 | ~~¿Globo (S1) en MVP?~~ **cerrada: globo MapLibre con teselas (ADR-021, ADR-022)** | HEAD | F5 |
| O-12 | ~~Leaflet vs MapLibre~~ **cerrada para MVP: SVG sin teselas (ADR-012)** | Sonnet (propone) + HEAD | F1 |
| O-13 | ~~Humedad del suelo en UI~~ **cerrada: % de TAW del gemelo (ADR-018)** | Opus + HEAD | F1 |
| O-14 | ~~Presets~~ **provisional: ADR-018** | Opus + HEAD | F1 |
| O-15 | ~~Lámina de riego~~ **provisional: ADR-018** | Opus | F1 |
| O-16 | ~~Umbrales de estrés~~ **provisional: ADR-018** | Opus + HEAD | F1 |
| O-17 | ~~Mapa base satelital~~ **fuera del MVP (ADR-012)** | Sonnet (propone) + HEAD | F1 |

## ADR-021 · Exploración global con teselas satelitales

**Decisión:** el recorrido global usa MapLibre GL JS con proyección globo y teselas por nivel de zoom. Sustituye la esfera R3F con textura fija (cierra O-11 y reabre O-12/O-17 en favor de teselas) y el zoom por escala CSS del mapa de parcela; Three.js se conserva para el gemelo local. Amplía ADR-012.

**Motivo:** una textura global fija no gana detalle al acercarse; las teselas permiten llegar a escala de campo sin descargar un mosaico mundial.

**Límites:** el detalle depende del proveedor y requiere red. Las imágenes de campos no equivalen a polígonos de parcelas globales. Seleccionar coordenadas consulta fuentes por API; no crea un gemelo nuevo.

**Estado:** aceptada.

## ADR-022 · MapLibre globe en lugar de three-globe o Cesium; un visor para globo y granja

**Contexto:** se pidió un globo realista con zoom continuo «tipo Google Maps» hasta las parcelas. **Decisión:** MapLibre GL JS 6 (`projection: globe`, `sky` para atmósfera), un único mapa para las etapas globo y granja (la etapa la decide la cámara) y el gemelo R3F aparte. Zoom bajo: NASA GIBS Blue Marble NG (dominio público, sin clave); zoom alto: Esri World Imagery con fundido cruzado z4.5–6.5. **Alternativas:** three-globe/esfera R3F (sin LOD por teselas), CesiumJS (≈3 MB más, terreno y token Ion innecesarios para imágenes 2D), Google Maps 3D (clave y términos). **Consecuencias:** sin claves; bundle MapLibre (~1.1 MB) cargado solo en esas etapas; el vuelo es `flyTo` en lugar de una cámara three.js.

**Estado:** aceptada.

## ADR-023 · Dependencia de red para teselas y degradación sin conexión

**Decisión:** las teselas globales requieren internet. Sin red se muestra un aviso explícito, un mosaico Blue Marble de 2048 px (Web Mercator, 447 kB, cosido de GIBS nivel 3) empaquetado en `frontend/public/textures/earth/` y, en el piloto, la ortofoto NAIP servida por el backend. **Pendiente:** verificar los términos de Esri World Imagery antes de un despliegue público o comercial (ver [credits](../07-design/credits.md)); el proveedor es configurable por variables `VITE_SATELLITE_*`.

**Estado:** aceptada (términos de Esri: abierto).

## ADR-024 · Proyecciones climáticas de NASA como fuente opcional del clima futuro

**Decisión.** El gemelo acepta `climate_source: "projection"` con `projection.scenario` (`ssp126`, `ssp245`, `ssp370`). El clima sale de la *Climate Projection API* de NASA POWER (NEX-GDDP-CMIP6, por punto). Sin `climate_source` no cambia nada: el año histórico de referencia sigue siendo el camino por defecto.

**Por qué.** Un año histórico responde "¿y si se parece a 2024?"; una proyección responde "¿qué esperan los modelos climáticos para ese año bajo un escenario de emisiones?". La API responde por punto en segundos, igual que el clima histórico.

**Reglas.**
- **Nunca el promedio de modelos (`ensemble`) para el balance de agua:** su media diaria borra los días secos y las tormentas (verificado: 0 días secos de mayo a septiembre frente a 49 con un modelo). Se rechaza con 422.
- **Conjunto de modelos:** `ec_earth3`, `gfdl_esm4`, `ipsl_cm6a_lr`, `mpi_esm1_2_lr` (parámetro de producto, `DAILY_MODELS` en `providers/live/projection.py`). Se simula cada uno; el 3D anima el de lluvia mediana del periodo y cada zona informa el **rango entre modelos** (`projection_range`). Cada modelo es un futuro posible, no un pronóstico ni una probabilidad.
- **Conversiones:** radiación de W/m² a MJ/m²/día (× 0.0864; la API la etiqueta mal); viento de 10 m a 2 m con FAO-56 ec. 47 (× 0.748).
- **Días faltantes:** la API omite días de fin de diciembre y, según el calendario del modelo, el 29 de febrero. Se rellenan con la media de los días disponibles del propio modelo en una ventana de `PROJECTION_GAP_WINDOW_DAYS` (15) a cada lado, se marcan y se avisan.
- **Estado:** todo `SIMULATED`. El NDVI observado no se compara en estas corridas.
- **Fallo de la API (beta):** 503 con mensaje; la interfaz ofrece volver al año de referencia.

**Límites.** La radiación de NEX-GDDP-CMIP6 resultó mayor que la histórica de POWER en los puntos revisados, así que la ET0 puede salir más alta que con clima observado; se avisa en la respuesta. Rotaciones no usa proyecciones todavía.

