# Digital Farm: mapa 2D + diorama 3D (`digital_farm`)

> TL;DR: Leaflet para parcela y capas; diorama isométrico low-poly en React Three Fiber (ADR-009) que representa por zona el estado del gemelo y el escenario, ILUSTRATIVO. Globo = stretch. No calcula nada.
> Depende de: [data-contracts](../01-architecture/data-contracts.md), [design-tokens](../07-design/design-tokens.md), [ui-spec](../07-design/ui-spec.md)
> Estado: draft
> Última revisión: 2026-11-14

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

Leaflet se mantiene (O-12): el overlay es una imagen georreferenciada ya coloreada por el backend; MapLibre solo aportaría con teselas vectoriales o terreno 3D, que el MVP no usa. Acción: seleccionar parcela/zona → actualiza el store.

## Diorama 3D (R3F + drei)

### Composición de escena

| Elemento | Implementación | Dato que lo mueve |
|---|---|---|
| Base de terreno | Losa extruida del contorno de la granja (`ExtrudeGeometry`) con borde de tierra | geometría de la parcela normalizada |
| Zonas (1–4) | Polígono por `zone_id` sobre la losa, borde luminoso `accent.bright` | `FarmZone.geometry` |
| Surcos / plantas | `InstancedMesh` por zona (una geometría low-poly por `crop_id`: `corn`, `soybean`, cobertura) | `crop_id`, altura por `stage` |
| Árboles perimetrales | `InstancedMesh` (cono/icosaedro + tronco), posiciones con seed fija | decorativo |
| Camino, casa, silo, estanque | Primitivas (`Box`, `Cylinder`, plano con material de agua) | decorativo |
| Riego | Tubería (línea/cilindro) + aspersores; arcos de agua animados solo si `irrigation_level ≠ NONE` | `irrigation_level` |
| Etiquetas de zona | drei `Html` (DOM): nombre, cultivo, ha, valor de la capa activa + insignia `data_state` | `ZoneResult` |
| Colinas de fondo, niebla | Planos con color de `bg.app` | decorativo |

Geometría **procedural sin assets** (sin glTF ni Blender), determinista por seed para que la escena sea idéntica entre recargas.

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

## Globo (S1, stretch F5)

| Opción | Pro | Contra |
|---|---|---|
| `three-globe` dentro del mismo `<Canvas>` R3F (`<primitive>`) | Basado en three.js; capas de puntos/polígonos listas | Dependencia extra |
| `globe.gl` / `react-globe.gl` | Rápido de montar | Canvas propio, aparte del store/escena |
| Esfera propia R3F + textura NASA (Blue Marble) | Cero deps nuevas | Capas a mano |

Capas diarias: NASA GIBS/Worldview (WMTS) — **verificar disponibilidad, licencia y atribución** antes de depender de ellas; la demo debe funcionar offline con textura empaquetada. Prioridad siempre: flujo parcela → gemelo.

## Componentes sugeridos (`frontend/src/scene/`)

```
farm-diorama.tsx      # Canvas, ortho camera, lights, bounded OrbitControls
terrain-slab.tsx      # extruded farm outline
zone-field.tsx        # per-zone InstancedMesh + instanceColor
props.tsx             # house, silo, pond, road, trees (seeded)
irrigation.tsx        # pipes + sprinklers
zone-label.tsx        # drei Html label
layer-color.ts        # value -> color using styles/tokens.ts ramps
globe/                # stretch
```

## Presupuesto

5–8 h (dossier). Si amenaza al motor: losa + zonas coloreadas + etiquetas + timeline; sin props ni riego animado.

Builder/revisor: [agent-routing](../06-agents/agent-routing.md).
