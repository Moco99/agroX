import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DataStateBadge } from "../components/data-state-badge";
import { es } from "../i18n/es";
import { canopyFactor, layerColor, layerLabel, layerState, type ZoneView } from "../lib/derive";
import { localRing, type Projector } from "../lib/geo";
import { isPilotFarm } from "../lib/parcel";
import { cropLabel, ndviMissingText, stageStatusOf } from "../lib/farm-labels";
import { useParcelStore } from "../store/parcel-store";
import type { Layer } from "../store/twin-store";
import { useTwinStore } from "../store/twin-store";
import type { Farm } from "../types/api";
import { BuildingsLayer } from "./buildings-layer";
import { FrameWatchdog } from "./frame-watchdog";
import { ObservedTerrain } from "./observed-terrain";
import { CenterPivot, Farmstead, Fence, Ground, Pond, Road, Trees, type Extent } from "./props";
import { QualityContext } from "./quality-context";
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
// Fraction of the shorter viewport side the farm diagonal should occupy on first paint
const FIT_FRACTION = 0.68;

function ringExtent(ring: [number, number][]): Extent {
  const xs = ring.map((p) => p[0] * SCENE_SCALE);
  const ys = ring.map((p) => -p[1] * SCENE_SCALE);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...ys), maxZ: Math.max(...ys) };
}

// Orthographic zoom that frames the farm whatever its size: a 600 m point parcel and the 1.2 km
// pilot must both fill the canvas instead of sharing one zoom tuned for the pilot
function fittedZoom(extent: Extent, width: number, height: number): number {
  const diagonal = Math.hypot(extent.maxX - extent.minX, extent.maxZ - extent.minZ) || 1;
  return (Math.min(width, height) * FIT_FRACTION) / diagonal;
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
    if (!controls) return;
    const onStart = () => {
      touchedFor.current = farmId;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls, farmId]);
  useLayoutEffect(() => {
    if (touchedFor.current === farmId || size.width === 0 || size.height === 0) return;
    camera.zoom = fittedZoom(extent, size.width, size.height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, extent, farmId, invalidate]);
  return null;
}

export function FarmDiorama({ farm, projector, views, layer, date, selectedZoneId, onSelect }: FarmDioramaProps) {
  const { quality, settings, degrade } = useSceneQuality();
  // Observed building positions (scene x, z); null until the footprint request settles so the
  // farmstead never flashes on a spot that turns out to be occupied
  const [buildingSpots, setBuildingSpots] = useState<[number, number][] | null>(null);
  const cover = useTwinStore((s) => s.farm?.land_cover);
  const previewingRotation = useTwinStore((s) => s.rotationPreview !== null);
  const declaredCrops = useParcelStore((s) => s.declaration.crops);
  const heightmap = useTwinStore((s) => s.heightmap);
  const pilot = isPilotFarm(farm.farm_id);
  const ndviMissing = useTwinStore((s) => (pilot ? undefined : ndviMissingText(stageStatusOf(s.farm, "ndvi"))));
  const elevation = useElevation(projector);
  const surface = cover?.worldcover_2021 === "suelo desnudo" ? "#b9a77e" : cover?.worldcover_2021 === "bosque" ? "#384f35" : "#777568";
  const rings = useMemo(
    () => Object.fromEntries(farm.zones.map((z) => [z.zone_id, localRing(z.geometry, projector)])),
    [farm, projector],
  );
  const e = projector.extent;
  const extent: Extent = {
    minX: e.minX * SCENE_SCALE,
    maxX: e.maxX * SCENE_SCALE,
    minZ: -e.maxY * SCENE_SCALE,
    maxZ: -e.minY * SCENE_SCALE,
  };
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
  // A fixed portal target keeps drei <Html> from re-creating its React roots when the canvas parent settles
  const labelsRef = useRef<HTMLDivElement>(null!);
  const target = useMemo<[number, number, number]>(
    () => [(extent.minX + extent.maxX) / 2, 0, (extent.minZ + extent.maxZ) / 2],
    [extent.minX, extent.maxX, extent.minZ, extent.maxZ],
  );

  // A lost context is recoverable (preventDefault lets the browser restore it); run lighter afterwards
  const onCreated = useCallback(
    ({ gl }: { gl: THREE.WebGLRenderer }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
      gl.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        degrade("WebGL context lost");
      });
    },
    [degrade],
  );

  return (
    <div className="diorama" data-quality={quality}>
      <div ref={labelsRef} className="diorama-labels" />
      <Canvas
        key={settings.frameloop}
        // Plain PCF plus a per-light radius: r187 removed PCFSoftShadowMap and VSM leaks light under thin plants
        shadows={settings.shadows ? { type: THREE.PCFShadowMap } : false}
        orthographic
        dpr={settings.dpr}
        frameloop={settings.frameloop}
        camera={{ position: [14, 13, 14], zoom: 34, near: -100, far: 300 }}
        gl={{ antialias: settings.multisampling > 0 || !settings.ambientOcclusion, powerPreference: "high-performance" }}
        onCreated={onCreated}
      >
        <QualityContext.Provider value={settings}>
          <FrameWatchdog onDegrade={degrade} />
          <FitCamera extent={extent} farmId={farm.farm_id} />
          <SceneBackdrop />
          <SceneLights extent={groundExtent} />
          <ObservedTerrain projector={projector} fallbackBounds={groundBounds} fallbackColor={pilot ? "#526741" : surface} />
          <BuildingsLayer projector={projector} bounds={heightmap?.bounds ?? groundBounds} onBuildings={setBuildingSpots} />
          <Ground extent={groundExtent} pad={0} surface={pilot ? undefined : surface} topPlane={Boolean(heightmap)} />
          {pilot && (
            <>
              <Road extent={extent} elevation={elevation} />
              <Pond extent={extent} elevation={elevation} />
              <Trees extent={extent} elevation={elevation} />
              {buildingSpots && <Farmstead extent={extent} elevation={elevation} avoid={buildingSpots} />}
              <Fence extent={extent} elevation={elevation} />
            </>
          )}
          {views.map((v) => {
            const ring = rings[v.zone.zone_id];
            if (!ring) return null;
            const centroid = farm.zones.find((z) => z.zone_id === v.zone.zone_id)?.centroid;
            const [cx, cy] = centroid ? projector.toLocal(centroid.lon, centroid.lat) : [0, 0];
            const sx = cx * SCENE_SCALE;
            const sz = -cy * SCENE_SCALE;
            const sy = elevation(cx, cy);
            // Point farms have four equal squares: push each label outward from the farm centre so they do not stack
            const lx = pilot ? sx : sx + Math.sign(sx - target[0]) * 0.9;
            const lz = pilot ? sz : sz + Math.sign(sz - target[2]) * 0.5;
            const showPlants = pilot || previewingRotation || Boolean(declaredCrops[v.zone.zone_id]);
            const crop = cropLabel(v.zone.crop_id, showPlants);
            const ze = ringExtent(ring);
            const pivotRadius = Math.min(ze.maxX - ze.minX, ze.maxZ - ze.minZ) * PIVOT_SPAN;
            return (
              <group key={v.zone.zone_id}>
                <ZoneField
                  projector={projector}
                  zoneId={v.zone.zone_id}
                  cropId={v.zone.crop_id}
                  ring={ring}
                  fill={layerColor(v, layer)}
                  canopy={canopyFactor(v.zone, date)}
                  stage={v.state?.stage ?? null}
                  soilWater={v.state?.soil_water_fraction ?? null}
                  selected={selectedZoneId === v.zone.zone_id}
                  onSelect={onSelect}
                  showPlants={showPlants}
                />
                {v.zone.irrigation_level !== "NONE" && (
                  <CenterPivot
                    position={[sx, sy, sz]}
                    radius={pivotRadius}
                    active={(v.state?.irrigation_mm ?? 0) > 0 || layer === "irrigation"}
                  />
                )}
                <Html position={[lx, sy + 1.1, lz]} center zIndexRange={[20, 0]} portal={labelsRef}>
                  <button
                    type="button"
                    className={`zone-label${selectedZoneId === v.zone.zone_id ? " is-selected" : ""}`}
                    onClick={() => onSelect(v.zone.zone_id)}
                  >
                    <strong>{v.zone.name}</strong>
                    <span>
                      {crop.text} <DataStateBadge state={crop.state} compact /> · {v.zone.area_ha.toFixed(0)} ha
                    </span>
                    <span className="zone-label-value">
                      {es.layers[layer]}: {layerLabel(v, layer, ndviMissing)} <DataStateBadge state={layerState(v, layer)} compact />
                    </span>
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
            // Wide range because the fitted zoom differs ~2× between the pilot and a 600 m point parcel
            minZoom={12}
            maxZoom={160}
            minPolarAngle={0.35}
            maxPolarAngle={1.15}
            target={target}
          />
        </QualityContext.Provider>
      </Canvas>
    </div>
  );
}
