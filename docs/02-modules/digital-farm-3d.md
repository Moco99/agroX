# Digital Farm: mapa 2D + diorama 3D (`digital_farm`)

> TL;DR: Globo y mapa de granja en un solo visor MapLibre (teselas NASA GIBS + Esri, zoom continuo hasta campos; ADR-021/022); diorama isométrico en React Three Fiber (ADR-009) que representa por zona el estado del gemelo y el escenario, ILUSTRATIVO. No calcula nada.
> Depende de: [data-contracts](../01-architecture/data-contracts.md), [design-tokens](../07-design/design-tokens.md), [ui-spec](../07-design/ui-spec.md)
> Estado: draft
> Última revisión: 2026-11-15

Pantallas y layout: [ui-spec](../07-design/ui-spec.md) (S3 = este doc; S2 = [earth-scanner](earth-scanner.md)).

## Separación científica (regla dura)

El backend calcula; el frontend traduce a escena. Una zona roja en "sequía" es una **metáfora visual**, no una predicción botánica. Nunca prometer crecimiento físico ni producción. Leyenda fija en el lienzo: **"Representación ilustrativa — no es una predicción"** + insignia `data_state`.

## Mapa 2D (Leaflet)

| Elemento | Fuente |
|---|---|
| Base | Satelital (proveedor/licencia TBD, O-17) u OSM, siempre con atribución |
| Bbox de la zona | `scraper/sources.json` `area.bbox` |
| Parcela y zonas | `derived/parcel/<parcel_id>.geojson` (O-2) con `zone_id` por polígono |
| Overlay NDVI | `L.imageOverlay` con PNG + `bounds` de `GET /api/observations/ndvi-overlay` |
| Otras capas | CDL por año (PNG recortado) |

Histórico (O-12): se planeó Leaflet; desde ADR-021 el mapa de granja es MapLibre (mismo visor que el globo) y el NDVI se dibuja como imagen georreferenciada ya coloreada por el backend. Acción: seleccionar parcela/zona → actualiza el store.

## Diorama 3D (R3F + drei)

### Composición de escena

| Elemento | Implementación | Dato que lo mueve |
|---|---|---|
| Base de terreno | Relieve del DEM drapeado con la imagen base (`observed-terrain.tsx`), **faldón** de tierra hasta la losa y losa con tres estratos (`Ground` en `props.tsx`) | `/api/terrain/heightmap`, `/api/imagery/basemap` |
| Zonas (1–4) | Malla recortada al polígono y drapeada sobre el relieve (`zone-field.tsx`); borde `Line` con la capa activa, `accent.bright` + bloom si está seleccionada | `FarmZone.geometry` |
| Suelo | Textura de surcos procedural; el color oscurece con `soil_water_fraction` (más húmedo = más oscuro, solo metáfora) y se tiñe con la capa activa | `TwinState.soil_water_fraction`, capa |
| Plantas | Un `InstancedMesh` por zona con un arquetipo procedural por `crop_id` (`plant-geometry.ts`: `tall_grass` maíz/sorgo, `bush` soya/frijol, `small_grain` trigo/centeno/avena, `sunflower`, `cover`). El shader (`plant-material.ts`) anima altura, órganos reproductivos, senescencia, tinte de capa y viento con uniformes suavizados; también en el paso de sombras | `expected_canopy`, `TwinState.stage` (`PRE_PLANTING` suelo desnudo → … → `HARVESTED` rastrojo) |
| Edificios observados | Huellas OSM extruidas (`buildings-layer.tsx`), techo y muros con materiales distintos; altura exagerada ×3 | footprints del backend |
| Árboles, cerca, camino, estanque, granero/silo | `InstancedMesh` con seed fija (`props.tsx`); solo en la parcela piloto. El granero solo se dibuja en un sitio sin edificio observado | decorativo |
| Riego | Pivote central (`CenterPivot`) solo si `irrigation_level ≠ NONE`; gira y rocía solo los días con `irrigation_mm > 0` o con la capa Riego activa | `irrigation_level`, `TwinState.irrigation_mm` |
| Etiquetas de zona | drei `Html` (DOM): nombre, cultivo, ha, valor de la capa activa + insignia `data_state` | `ZoneResult` |
| Cielo e iluminación | Gradiente de pantalla completa (`SceneBackdrop`), sol direccional con sombras PCF, luz de borde fría y entorno IBL local con `Lightformer` (sin HDR descargado) (`scene-environment.tsx`) | — |
| Post-proceso | N8AO (oclusión ambiental), SMAA, bloom y viñeta sutiles, según nivel de calidad | — |

Geometría **procedural sin assets** (sin glTF ni Blender), determinista por seed para que la escena sea idéntica entre recargas. Las proporciones de las plantas son visuales, no agronómicas: no codifican alturas reales ni espaciamientos de siembra.

### Niveles de calidad y degradación

`lib/scene-quality.ts` (puro, con tests) elige `high | medium | low` a partir de la GPU (`UNMASKED_RENDERER_WEBGL`, `MAX_TEXTURE_SIZE`, núcleos, memoria, móvil, `prefers-reduced-motion`). `?quality=high|medium|low` fija el nivel para demos. Cada nivel define `dpr`, sombras y tamaño del mapa, AO, bloom, viñeta, densidad e instancias máximas por zona, viento y `frameloop`. Un vigilante de cuadros (`frame-watchdog.tsx`) baja un nivel si la media cae de 26 fps dos ventanas seguidas; la pérdida de contexto WebGL también baja un nivel; nunca se sube solo. El atributo `data-quality` del `.diorama` expone el nivel activo. Sin WebGL, la pestaña cae al mapa 2D como antes.

### Capas de color

| Capa | Dato | Escala |
|---|---|---|
| NDVI (vigor) | `ZoneResult.ndvi` (observado/sintético) | rampa NDVI de [design-tokens](../07-design/design-tokens.md) |
| Estrés hídrico | `ks` (1 = sin estrés) | rampa estrés (verde→ámbar→rojo), umbrales TBD (O-16) |
| Humedad del suelo | depleción / TAW (O-13) | rampa secuencial TBD en tokens |
| Temperatura | `t_max` del día | rampa TBD |
| Riego | `irrigation_level` | resalta tuberías/aspersores |

Color **por zona** (material o atributo de instancia `instanceColor`) en MVP; gradiente intra-zona con vertex colors solo si hay ráster real por zona (stretch). Con escenario activo la capa por defecto es **estrés** (el gemelo no simula NDVI, ver [data-contracts](../01-architecture/data-contracts.md)).

### Cámara, interacción, rendimiento

- `OrthographicCamera` isométrica; `OrbitControls` con azimut/polar/zoom acotados (sin ver por debajo de la losa).
- Paneles, leyenda, rosa de los vientos, escala y timeline en **DOM fuera del `<Canvas>`**; solo las etiquetas de zona usan `Html`.
- Estado compartido con mapa 2D y gráficas vía **store único** (O-10): zona seleccionada, capa activa, fecha, escenario.
- Presupuesto (TBD, medir en el portátil de demo): FPS objetivo, número máximo de instancias, `dpr` máximo. `frameloop="demand"` cuando no hay animación.
- Fallback sin WebGL (detección al montar): pestaña "Mapa 2D" con zonas coloreadas igual.

### Línea de tiempo

Hitos por etapa fenológica (`PhenoStage`, UI: Siembra, Desarrollo, Floración, Llenado, Cosecha; mapeo exacto TBD) derivados de `TwinState.stage`/`gdd_cum` de la zona seleccionada; fechas reales de la temporada (no el calendario del mockup). Play avanza día a día sobre `states` ya calculados (no re-simula).

## Globo (S1)

Implementado con MapLibre GL JS (ADR-022), no con `three-globe` ni una esfera R3F: ver «Recorrido de exploración» abajo. Las capas NASA GIBS se verificaron (WMTS `GoogleMapsCompatible_Level8`, CORS abierto, niveles 0–8) y la demo degrada a un mosaico empaquetado sin red (ADR-023).

## Componentes sugeridos (`frontend/src/scene/`)

```
farm-diorama.tsx      # Canvas, ortho camera fitted to the farm, quality provider, labels, bounded OrbitControls
observed-terrain.tsx  # DEM relief draped with the basemap + soil skirt
buildings-layer.tsx   # observed footprints extruded (roof/wall materials)
zone-field.tsx        # draped soil (moisture tone) + instanced crop rows per zone
plant-geometry.ts     # procedural plant archetypes per growth form
plant-material.ts     # shader patch: growth, organs, senescence, tint, wind
props.tsx             # slab strata, pond, road, trees, farmstead, fence, centre pivot (seeded)
scene-environment.tsx # backdrop, sun/sky/IBL lights, post-processing
terrain-sampler.ts    # shared scene scale and elevation sampler
frame-watchdog.tsx    # fps watchdog that lowers the quality tier
use-scene-quality.ts  # quality state (probe, URL override, degrade)
quality-context.ts    # React context for the quality settings
../lib/crop-visuals.ts   # crop_id -> growth form, stage -> visual, row layout, soil tone (pure, tested)
../lib/scene-quality.ts  # quality tiers (pure, tested)
```

## Presupuesto

5–8 h (dossier). Si amenaza al motor: losa + zonas coloreadas + etiquetas + timeline; sin props ni riego animado.

Builder/revisor: [agent-routing](../06-agents/agent-routing.md).

## Recorrido de exploración (globo → granja → gemelo)

Las etapas globo y granja comparten **un solo visor MapLibre GL JS** en proyección `globe` (`frontend/src/screens/geographic/`); la etapa se decide por la cámara (`stageForCamera` en `lib/globe-view.ts`, con histéresis 12.5/9) o por un vuelo explícito. El gemelo R3F es otra escena, cargada bajo demanda. Máquina de etapas: `store/stage-store.ts` (`idle | flying | fading | revealing`); peticiones de vuelo y cámara compartida: `store/map-store.ts`; consulta por punto: `store/point-store.ts`. Deep links `?stage=globe|map|twin`.

Capas del visor: mosaico Blue Marble empaquetado (respaldo sin red) → NASA GIBS Blue Marble NG (z0–8) → Esri World Imagery (desde z4.5, fundido hasta z6.5, máx. z19) → ortofoto NAIP del piloto (solo sin conexión) → NDVI Sentinel-2 por fecha → zonas y contorno de la granja (GeoJSON de `/api/farms/analyze`). Caché de teselas acotada (320) y `map.remove()` al desmontar. El worker de MapLibre 6 se resuelve con `?worker&url` + `setWorkerUrl` (el pre-bundling de Vite rompe su ruta relativa).

## Cobertura honesta

La imagen satelital muestra campos en todo el mundo, pero **polígonos de parcela, NDVI por fecha y gemelo existen solo en la granja piloto de Story County, Iowa**. Fuera del piloto la UI lo dice explícitamente y ofrece la consulta por punto (`POST /api/points/query`), que no crea un gemelo ni reutiliza el del piloto. Las teselas requieren red; la resolución y la fecha varían por ubicación y no se promete imagen submétrica. El gemelo Three.js sigue siendo una vista local ilustrativa (cultivos, infraestructura y crecimiento ilustrativos sobre ortofoto NAIP y DEM reales).

Proveedor de alto zoom configurable (`VITE_SATELLITE_TILE_URL`, `VITE_SATELLITE_ATTRIBUTION`); cualquier clave publicada por Vite debe ser pública y restringida, nunca un secreto. Créditos: [credits](../07-design/credits.md).

## Gemelo de cualquier parcela

El diorama usa la parcela activa: 4 zonas con su cultivo declarado, capas (NDVI observado, estrés, humedad, temperatura, riego), panel de escenario (`precip_factor`, `temp_delta_c`, `irrigation_level`, presets), KPI con insignias y la explicación determinista del piloto. Un resumen «Cultivo y fecha de siembra» (insignias `DECLARED`/`ESTIMATED`) enlaza al formulario del mapa de granja. El suelo del terreno es la imagen base y el relieve de la parcela cuando `/api/imagery/basemap` y `/api/terrain/heightmap` aceptan `farm_id=pt_*`; si faltan, se usa suelo procedural y terreno plano con la nota visible «Sin imagen base ni relieve para esta parcela». Al cambiar de parcela se cancelan las peticiones en vuelo y se descarta el estado de la anterior.
