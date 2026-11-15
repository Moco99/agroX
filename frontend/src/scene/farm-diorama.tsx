import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DataStateBadge } from "../components/data-state-badge";
import { es } from "../i18n/es";
import { canopyFactor, layerColor, layerLabel, layerState, type ZoneView } from "../lib/derive";
import { localRing, type Projector } from "../lib/geo";
import { isPilotFarm } from "../lib/parcel";
import { cropLabel, ndviMissingText, stageStatusOf } from "../lib/farm-labels";
import { fittedZoom, MAX_ZOOM, MIN_ZOOM, pickFarmsteadSite, ringExtent, type Extent } from "../lib/scene-layout";
import { useParcelStore } from "../store/parcel-store";
import type { Layer } from "../store/twin-store";
import { useTwinStore } from "../store/twin-store";
import type { Farm } from "../types/api";
import { BuildingsLayer } from "./buildings-layer";
import { FrameWatchdog } from "./frame-watchdog";
import { ObservedTerrain } from "./observed-terrain";
import { CenterPivot, Farmstead, Fence, Ground, Pond, Road, Trees } from "./props";
import { QualityContext, useQuality } from "./quality-context";
import { SceneBackdrop, SceneEffects, SceneLights } from "./scene-environment";
import { SCENE_SCALE, useElevation } from "./terrain-sampler";
import { useSceneQuality } from "./use-scene-quality";
import { ZoneField } from "./zone-field";

// ─────────────────────────────────────────
// Section: Isometric low-poly diorama (illustrative; it computes nothing)
// ─────────────────────────────────────────
//
// Everything drawn here is a metaphor for backend outputs: plant height follows the expected
// canopy curve, organs and senescence follow TwinState.stage, soil colour follows
// soil_water_fraction and the pivot only exists when the zone's irrigation_level is not NONE.
// Buildings, trees, the pond and the road are decoration or observed footprints, never data.

interface FarmDioramaProps {
  farm: Farm;
  projector: Projector;
  views: ZoneView[];
  layer: Layer;
  date: string | undefined;
  selectedZoneId: string | null;
  onSelect: (id: string) => void;
}

// Pivot span as a fraction of the zone's shorter side, so the arm stays inside the zone
const PIVOT_SPAN = 0.42;
// Wind and water keep animating this long after the last pointer input; then the loop idles
const IDLE_MS = 4000;

// ─────────────────────────────────────────
// Section: Camera fit
// ─────────────────────────────────────────

// The R3F store types `controls` as a bare EventDispatcher; OrbitControls additionally emits "start"
interface StartDispatcher {
  addEventListener(type: "start", listener: () => void): void;
  removeEventListener(type: "start", listener: () => void): void;
}

function emitsStart(value: unknown): value is StartDispatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { addEventListener?: unknown }).addEventListener === "function" &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener === "function"
  );
}

// Follows container resizes (the stage reveal animates the canvas size) until the user touches the
// controls; from then on their zoom is respected. A new farm starts the cycle again.
function FitCamera({ extent, farmId }: { extent: Extent; farmId: string }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);
  const invalidate = useThree((s) => s.invalidate);
  const touchedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Widened to unknown first: narrowing the store type directly keeps its `never` event map
    const dispatcher: unknown = controls;
    if (!emitsStart(dispatcher)) return;
    const onStart = () => {
      touchedFor.current = farmId;
    };
    dispatcher.addEventListener("start", onStart);
    return () => dispatcher.removeEventListener("start", onStart);
  }, [controls, farmId]);
  useLayoutEffect(() => {
    if (touchedFor.current === farmId || size.width === 0 || size.height === 0) return;
    camera.zoom = fittedZoom(extent, size.width, size.height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, extent, farmId, invalidate]);
  return null;
}

// ─────────────────────────────────────────
// Section: Render loop control and recovery
// ─────────────────────────────────────────

// A lost context is recoverable (preventDefault lets the browser restore it); run lighter afterwards.
// The listener is removed on unmount because R3F forces a context loss when the root is destroyed,
// which must not count as a GPU problem (also keeps StrictMode's mount/unmount pass silent).
function ContextLossGuard({ onLost }: { onLost: (reason: string) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    let mounted = true;
    const handler = (event: Event) => {
      event.preventDefault();
      if (mounted) onLost("WebGL context lost");
    };
    el.addEventListener("webglcontextlost", handler);
    return () => {
      mounted = false;
      el.removeEventListener("webglcontextlost", handler);
    };
  }, [gl, onLost]);
  return null;
}

// Wind, water and the pivot need continuous frames, but only while someone is watching: pointer
// activity on the canvas, the timeline playing or a pivot spraying. Idle or hidden, the canvas stays
// in demand mode and redraws only on state changes, which is what keeps a laptop battery alive.
function SceneTicker({ pivotsActive }: { pivotsActive: boolean }) {
  const quality = useQuality();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const playing = useTwinStore((s) => s.playing);
  const lastInput = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    const wake = () => {
      lastInput.current = performance.now();
      invalidate();
    };
    const events = ["pointermove", "pointerdown", "wheel", "touchstart"] as const;
    events.forEach((name) => el.addEventListener(name, wake, { passive: true }));
    return () => events.forEach((name) => el.removeEventListener(name, wake));
  }, [gl, invalidate]);
  // Store or prop changes arrive without a frame: kick one so the loop below can take over
  useEffect(() => {
    if (playing || pivotsActive) invalidate();
  }, [playing, pivotsActive, invalidate]);
  useFrame(() => {
    if (!quality.animate || document.hidden) return;
    if (playing || pivotsActive || performance.now() - lastInput.current < IDLE_MS) invalidate();
  });
  return null;
}

// ─────────────────────────────────────────
// Section: Diorama
// ─────────────────────────────────────────

interface ZoneLayout {
  ring: [number, number][];
  position: [number, number, number];
  label: [number, number, number];
  pivotRadius: number;
}

export function FarmDiorama({ farm, projector, views, layer, date, selectedZoneId, onSelect }: FarmDioramaProps) {
  const { quality, settings, degrade } = useSceneQuality();
  // Observed footprints in scene space: undefined while loading, null when the request failed
  // (not the same as an empty field), otherwise the boxes decorative props must stay clear of
  const [footprints, setFootprints] = useState<Extent[] | null | undefined>(undefined);
  const cover = useTwinStore((s) => s.farm?.land_cover);
  const previewingRotation = useTwinStore((s) => s.rotationPreview !== null);
  const previewDataMode = useTwinStore((s) => s.baseline?.data_mode);
  const declaredCrops = useParcelStore((s) => s.declaration.crops);
  const heightmap = useTwinStore((s) => s.heightmap);
  const pilot = isPilotFarm(farm.farm_id);
  const ndviMissing = useTwinStore((s) => (pilot ? undefined : ndviMissingText(stageStatusOf(s.farm, "ndvi"))));
  const elevation = useElevation(projector);
  const surface = cover?.worldcover_2021 === "suelo desnudo" ? "#b9a77e" : cover?.worldcover_2021 === "bosque" ? "#384f35" : "#777568";
  const e = projector.extent;
  // Memoised on the four numbers: a new object per render would re-seed trees, fence and camera fit every timeline day
  const extent = useMemo<Extent>(
    () => ({ minX: e.minX * SCENE_SCALE, maxX: e.maxX * SCENE_SCALE, minZ: -e.maxY * SCENE_SCALE, maxZ: -e.minY * SCENE_SCALE }),
    [e.minX, e.maxX, e.minY, e.maxY],
  );
  // Ground slab spans the farm extent plus 300 m on every side; imagery, terrain and buildings share that box
  const groundBounds = useMemo(() => {
    const [west, south] = projector.fromLocal(e.minX - 300, e.minY - 300);
    const [east, north] = projector.fromLocal(e.maxX + 300, e.maxY + 300);
    return { west, south, east, north };
  }, [projector, e]);
  // The slab must cover exactly the textured terrain (the DEM bounds can differ from the farm box), else a bare rim shows
  const groundExtent = useMemo<Extent>(() => {
    const b = heightmap?.bounds ?? groundBounds;
    const [west, north] = projector.toLocal(b.west, b.north);
    const [east, south] = projector.toLocal(b.east, b.south);
    return { minX: west * SCENE_SCALE, maxX: east * SCENE_SCALE, minZ: -north * SCENE_SCALE, maxZ: -south * SCENE_SCALE };
  }, [heightmap, groundBounds, projector]);
  const target = useMemo<[number, number, number]>(
    () => [(extent.minX + extent.maxX) / 2, 0, (extent.minZ + extent.maxZ) / 2],
    [extent],
  );
  // Per-zone scene geometry, recomputed only when the farm or the relief changes, never per timeline day
  const zoneLayouts = useMemo<Record<string, ZoneLayout>>(
    () =>
      Object.fromEntries(
        farm.zones.map((z) => {
          const ring = localRing(z.geometry, projector);
          const [cx, cy] = projector.toLocal(z.centroid.lon, z.centroid.lat);
          const sx = cx * SCENE_SCALE;
          const sz = -cy * SCENE_SCALE;
          const sy = elevation(cx, cy);
          const ze = ringExtent(ring, SCENE_SCALE);
          // Point farms have four equal squares: push each label outward from the farm centre so they do not stack
          const lx = pilot ? sx : sx + Math.sign(sx - target[0]) * 0.9;
          const lz = pilot ? sz : sz + Math.sign(sz - target[2]) * 0.5;
          const layout: ZoneLayout = {
            ring,
            position: [sx, sy, sz],
            label: [lx, sy + 1.1, lz],
            pivotRadius: Math.min(ze.maxX - ze.minX, ze.maxZ - ze.minZ) * PIVOT_SPAN,
          };
          return [z.zone_id, layout];
        }),
      ),
    [farm, projector, elevation, pilot, target],
  );
  const farmsteadSite = useMemo(() => pickFarmsteadSite(extent, groundExtent, footprints ?? null), [extent, groundExtent, footprints]);
  const pivotsActive = views.some(
    (v) => v.zone.irrigation_level !== "NONE" && ((v.state?.irrigation_mm ?? 0) > 0 || layer === "irrigation"),
  );
  // A fixed portal target keeps drei <Html> from re-creating its React roots when the canvas parent settles
  const labelsRef = useRef<HTMLDivElement>(null!);

  const onCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
  }, []);
  // MSAA on the default framebuffer is wasted once a composer renders into its own targets
  const composer = settings.ambientOcclusion || settings.bloom || settings.vignette;

  return (
    <div className="diorama" data-quality={quality}>
      <div ref={labelsRef} className="diorama-labels" />
      <Canvas
        // Shadow map support is fixed at renderer creation, so a tier change that toggles it remounts
        key={String(settings.shadows)}
        // Plain PCF plus a per-light radius: r187 removed PCFSoftShadowMap and VSM leaks light under thin plants
        shadows={settings.shadows ? { type: THREE.PCFShadowMap } : false}
        orthographic
        dpr={settings.dpr}
        // Always on demand: SceneTicker requests frames while something is worth animating
        frameloop="demand"
        camera={{ position: [14, 13, 14], zoom: 34, near: -100, far: 300 }}
        gl={{ antialias: !composer, powerPreference: "high-performance" }}
        onCreated={onCreated}
      >
        <QualityContext.Provider value={settings}>
          <ContextLossGuard onLost={degrade} />
          <FrameWatchdog onDegrade={degrade} />
          <SceneTicker pivotsActive={pivotsActive} />
          <FitCamera extent={extent} farmId={farm.farm_id} />
          <SceneBackdrop />
          <SceneLights extent={groundExtent} />
          <ObservedTerrain projector={projector} fallbackBounds={groundBounds} fallbackColor={pilot ? "#526741" : surface} />
          <BuildingsLayer projector={projector} bounds={heightmap?.bounds ?? groundBounds} onBuildings={setFootprints} />
          <Ground extent={groundExtent} pad={0} surface={pilot ? undefined : surface} topPlane={Boolean(heightmap)} />
          {pilot && (
            <>
              <Road extent={extent} elevation={elevation} />
              <Pond extent={extent} elevation={elevation} />
              <Trees extent={extent} elevation={elevation} />
              <Farmstead site={farmsteadSite} elevation={elevation} />
              <Fence extent={extent} elevation={elevation} />
            </>
          )}
          {views.map((v) => {
            const zone = zoneLayouts[v.zone.zone_id];
            if (!zone) return null;
            const irrigated = v.zone.irrigation_level !== "NONE";
            const showPlants = pilot || previewingRotation || Boolean(declaredCrops[v.zone.zone_id]);
            const crop = cropLabel(v.zone.crop_id, showPlants);
            return (
              <group key={v.zone.zone_id}>
                <ZoneField
                  projector={projector}
                  zoneId={v.zone.zone_id}
                  cropId={v.zone.crop_id}
                  ring={zone.ring}
                  fill={layerColor(v, layer)}
                  canopy={canopyFactor(v.zone, date)}
                  stage={v.state?.stage ?? null}
                  soilWater={v.state?.soil_water_fraction ?? null}
                  selected={selectedZoneId === v.zone.zone_id}
                  onSelect={onSelect}
                  showPlants={showPlants}
                />
                {irrigated && (
                  <CenterPivot
                    position={zone.position}
                    radius={zone.pivotRadius}
                    active={(v.state?.irrigation_mm ?? 0) > 0 || layer === "irrigation"}
                  />
                )}
                <Html position={zone.label} center zIndexRange={[20, 0]} portal={labelsRef}>
                  <button
                    type="button"
                    className={`zone-label${selectedZoneId === v.zone.zone_id ? " is-selected" : ""}`}
                    onClick={() => onSelect(v.zone.zone_id)}
                  >
                    <strong>{v.zone.name}</strong>
                    <span>
                      {crop.text} <DataStateBadge state={previewingRotation ? (previewDataMode === "synthetic" ? "SYNTHETIC" : "SIMULATED") : crop.state} compact /> · {v.zone.area_ha.toFixed(0)} ha
                    </span>
                    <span className="zone-label-value">
                      {es.layers[layer]}: {layerLabel(v, layer, ndviMissing)} <DataStateBadge state={layerState(v, layer)} compact />
                    </span>
                    {irrigated && <span className="zone-label-note">{es.twin.pivotIllustrative}</span>}
                  </button>
                </Html>
              </group>
            );
          })}
          <SceneEffects />
          <OrbitControls
            makeDefault
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            // Same limits fittedZoom clamps to, so the first wheel gesture never jumps
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            minPolarAngle={0.35}
            maxPolarAngle={1.15}
            target={target}
          />
        </QualityContext.Provider>
      </Canvas>
    </div>
  );
}
