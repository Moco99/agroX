# Decisiones (ADRs)

> TL;DR: Registro de decisiones de arquitectura (ADR-001..011) y lista de decisiones abiertas. Gana sobre cualquier otro doc.
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

## Decisiones abiertas

| # | Pregunta | Dueño | Bloquea |
|---|---|---|---|
| O-1 | Confirmar piloto Iowa (ADR-001) | Equipo | Pitch, catálogo |
| O-2 | Parcela piloto concreta (polígono) a partir de CDL 2021–2024 | HEAD + Opus | F3 |
| O-3 | Cobertura: `cereal_rye` u `oat` | HEAD | Catálogo |
| O-4 | Fuente de Kc y parámetros de cultivo (FAO-56 tablas vs extensión Iowa State) | Opus + HEAD | F3 |
| O-5 | Dónde y desde qué rama se despliega el backend (Railway/Render/otro) | Moco | F5 |
| O-6 | Unidades de `ALLSKY_SFC_SW_DWN` en la respuesta POWER AG (MJ vs kWh) | Opus | F2 |
| O-7 | Historia larga de POWER (desde 1981) para SPI/años análogos | Opus | F2 |
| O-8 | Definición operativa de A, Ssuelo, C (mapeo a 0–100) | HEAD + Opus | F1 |
| O-9 | Proveedor LLM y si el Copilot entra al MVP | HEAD | F5 |
| O-10 | Zustand vs Context para estado global del frontend | Sonnet (propone) | F1 |
| O-11 | ¿Globo (S1) en MVP? Propuesta: no, stretch F5 (`three-globe` o esfera R3F) | HEAD | F5 |
| O-12 | Leaflet vs MapLibre GL. Propuesta: Leaflet (ya decidido; overlay PNG basta) | Sonnet (propone) + HEAD | F1 |
| O-13 | Humedad del suelo en UI: agua del gemelo (mm / % de TAW) vs índice POWER `GWETROOT` (0–1) | Opus + HEAD | F1 |
| O-14 | Parámetros del preset "sequía moderada" y demás presets | Opus + HEAD | F1 |
| O-15 | Lámina de riego (mm) por `irrigation_level` y calendario | Opus | F1 |
| O-16 | Umbrales de "estrés esperado" sobre `ks` (bajo/medio/alto) | Opus + HEAD | F1 |
| O-17 | Mapa base satelital (proveedor, licencia y atribución) | Sonnet (propone) + HEAD | F1 |
