import { ObservedTerrain } from "./observed-terrain";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { DataStateBadge } from "../components/data-state-badge";
import { es } from "../i18n/es";
import { canopyFactor, layerColor, layerLabel, layerState, type ZoneView } from "../lib/derive";
import { localRing, type Projector } from "../lib/geo";
import type { Layer } from "../store/twin-store";
import { color } from "../styles/tokens";
import type { Farm } from "../types/api";
import { Ground, Pond, Road, Sprinkler, Trees } from "./props";
import { BuildingsLayer } from "./buildings-layer";
import { SCENE_SCALE, ZoneField } from "./zone-field";
import { useTwinStore } from "../store/twin-store";
import { useParcelStore } from "../store/parcel-store";
import { isPilotFarm } from "../lib/parcel";

// ─────────────────────────────────────────
// Section: Isometric low-poly diorama (illustrative; it computes nothing)
// ─────────────────────────────────────────

interface FarmDioramaProps {
  farm: Farm;
  projector: Projector;
  views: ZoneView[];
  layer: Layer;
  date: string | undefined;
  selectedZoneId: string | null;
  onSelect: (id: string) => void;
}

export function FarmDiorama({ farm, projector, views, layer, date, selectedZoneId, onSelect }: FarmDioramaProps) {
  const cover = useTwinStore((s) => s.farm?.land_cover);
  const previewingRotation = useTwinStore((s) => s.rotationPreview !== null);
  const declaredCrops = useParcelStore((s) => s.declaration.crops);
  const pilot = isPilotFarm(farm.farm_id);
  const surface = cover?.worldcover_2021 === "suelo desnudo" ? "#b9a77e" : cover?.worldcover_2021 === "bosque" ? "#384f35" : "#777568";
  const rings = useMemo(
    () => Object.fromEntries(farm.zones.map((z) => [z.zone_id, localRing(z.geometry, projector)])),
    [farm, projector],
  );
  const e = projector.extent;
  const extent = {
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
  const heightmap = useTwinStore((s) => s.heightmap);
  const anyIrrigation = views.some((v) => v.zone.irrigation_level !== "NONE");
  // A fixed portal target keeps drei <Html> from re-creating its React roots when the canvas parent settles
  const labelsRef = useRef<HTMLDivElement>(null!);

  return (
    <div className="diorama">
      <div ref={labelsRef} className="diorama-labels" />
    <Canvas
      shadows
      orthographic
      dpr={[1, 2]}
      frameloop={anyIrrigation ? "always" : "demand"}
      camera={{ position: [14, 13, 14], zoom: 34, near: -100, far: 300 }}
      style={{ background: color.bg.app }}
    >
      <hemisphereLight args={["#DDE8FF", "#2A2016", 0.9]} />
      <directionalLight castShadow position={[10, 18, 6]} intensity={2.4} shadow-mapSize={[2048,2048]} />
      <ObservedTerrain projector={projector} fallbackBounds={groundBounds} fallbackColor={pilot ? "#526741" : surface}/>
      <BuildingsLayer projector={projector} bounds={heightmap?.bounds ?? groundBounds} />
      <ContactShadows position={[0,-.15,0]} opacity={.4} scale={60} blur={2} far={20}/>
      <Ground extent={extent} surface={pilot ? undefined : surface} topPlane={Boolean(heightmap)} />
      {pilot && <><Road extent={extent} /><Pond extent={extent} /><Trees extent={extent} /></>}
      {views.map((v) => {
        const ring = rings[v.zone.zone_id];
        if (!ring) return null;
        const centroid = farm.zones.find((z) => z.zone_id === v.zone.zone_id)?.centroid;
        const [cx, cy] = centroid ? projector.toLocal(centroid.lon, centroid.lat) : [0, 0];
        const sx = cx * SCENE_SCALE;
        const sz = -cy * SCENE_SCALE;
        // Point farms have four equal squares: push each label outward from the farm centre so they do not stack
        const lx = pilot ? sx : sx + Math.sign(sx - (extent.minX + extent.maxX) / 2) * 0.9;
        const lz = pilot ? sz : sz + Math.sign(sz - (extent.minZ + extent.maxZ) / 2) * 0.5;
        return (
          <group key={v.zone.zone_id}>
            <ZoneField
              projector={projector}
              zoneId={v.zone.zone_id}
              cropId={v.zone.crop_id}
              ring={ring}
              fill={layerColor(v, layer)}
              canopy={canopyFactor(v.zone, date)}
              selected={selectedZoneId === v.zone.zone_id}
              onSelect={onSelect}
              showPlants={pilot || previewingRotation || Boolean(declaredCrops[v.zone.zone_id])}
            />
            {v.zone.irrigation_level !== "NONE" && (
              <Sprinkler position={[sx, 0, sz]} active={(v.state?.irrigation_mm ?? 0) > 0 || layer === "irrigation"} />
            )}
            <Html position={[lx, 1.1, lz]} center zIndexRange={[20, 0]} portal={labelsRef}>
              <button
                type="button"
                className={`zone-label${selectedZoneId === v.zone.zone_id ? " is-selected" : ""}`}
                onClick={() => onSelect(v.zone.zone_id)}
              >
                <strong>{v.zone.name}</strong>
                <span>
                  {pilot || previewingRotation || declaredCrops[v.zone.zone_id] ? (es.crops[v.zone.crop_id] ?? v.zone.crop_id) : es.unconfirmedCrop} · {v.zone.area_ha.toFixed(0)} ha
                </span>
                <span className="zone-label-value">
                  {es.layers[layer]}: {layerLabel(v, layer)} <DataStateBadge state={layerState(v, layer)} compact />
                </span>
              </button>
            </Html>
          </group>
        );
      })}
      <OrbitControls
        makeDefault
        enablePan={false}
        minZoom={18}
        maxZoom={90}
        minPolarAngle={0.35}
        maxPolarAngle={1.15}
        target={[(extent.minX + extent.maxX) / 2, 0, (extent.minZ + extent.maxZ) / 2]}
      />
    </Canvas>
    </div>
  );
}
