import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Projector } from "../lib/geo";
import { footprintBaseM } from "../lib/terrain-height";
import { useTwinStore } from "../store/twin-store";
import { fetchBuildings, type Building } from "../services/buildings";
import type { GeoBounds } from "../types/api";
import { useQuality } from "./quality-context";
import { SCENE_SCALE, TERRAIN_LIFT } from "./terrain-sampler";

// ─────────────────────────────────────────
// Section: Observed building footprints extruded into volumes (illustrative heights)
// ─────────────────────────────────────────

// Vertical exaggeration so footprints read as volumes at diorama scale (illustrative, not to scale)
const HEIGHT_EXAGGERATION = 3;
// ExtrudeGeometry assigns material index 0 to the caps (roof) and 1 to the side walls
const ROOF_GROUP = 0;
const WALL_GROUP = 1;

export function BuildingsLayer({
  projector,
  bounds,
  onBuildings,
}: {
  projector: Projector;
  bounds: GeoBounds;
  // Scene-space (x, z) centroids of the observed footprints, so decorative props can stay clear of them
  onBuildings?: (centroids: [number, number][]) => void;
}) {
  const heightmap = useTwinStore((s) => s.heightmap);
  const quality = useQuality();
  const [buildings, setBuildings] = useState<Building[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    void fetchBuildings(bounds, ctl.signal).then((b) => {
      if (ctl.signal.aborted) return;
      setBuildings(b);
      onBuildings?.(
        b.map((building) => {
          const n = building.ring.length || 1;
          const [lon, lat] = building.ring.reduce<[number, number]>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
          const [x, y] = projector.toLocal(lon, lat);
          return [x * SCENE_SCALE, -y * SCENE_SCALE];
        }),
      );
    });
    return () => ctl.abort();
    // onBuildings is deliberately not a dependency: the diorama passes a stable callback and a
    // re-fetch per render would hammer the buildings endpoint
  }, [bounds, projector]);
  const geometry = useMemo(() => {
    const parts = buildings.map((b) => {
      const shape = new THREE.Shape(
        b.ring.map(([lon, lat]) => {
          const [x, y] = projector.toLocal(lon, lat);
          return new THREE.Vector2(x * SCENE_SCALE, y * SCENE_SCALE);
        }),
      );
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.height_m * SCENE_SCALE * HEIGHT_EXAGGERATION, bevelEnabled: false });
      // Shape lives in XY and extrudes along +Z; stand it up so north is -Z and height is +Y
      g.rotateX(-Math.PI / 2);
      // Base on the lowest terrain under the footprint (same lift as ObservedTerrain); flat ground when no relief
      if (heightmap) g.translate(0, footprintBaseM(heightmap, b.ring) * SCENE_SCALE + TERRAIN_LIFT, 0);
      return g;
    });
    // Groups are kept so roofs and walls can take different materials from one merged mesh
    const merged = parts.length ? mergeGeometries(parts, true) : null;
    parts.forEach((p) => p.dispose());
    return merged;
  }, [buildings, projector, heightmap]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  const s = quality.shadows;
  return (
    <mesh geometry={geometry} position={[0, heightmap ? 0 : 0.05, 0]} castShadow={s} receiveShadow={s}>
      {/* Sheet-metal roofs and pale walls, the common look of Corn Belt farm buildings; purely illustrative */}
      <meshStandardMaterial attach={`material-${ROOF_GROUP}`} color="#6E6A66" roughness={0.55} metalness={0.25} />
      <meshStandardMaterial attach={`material-${WALL_GROUP}`} color="#D9D2C3" roughness={0.9} metalness={0} />
    </mesh>
  );
}
