import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Projector } from "../lib/geo";
import { footprintBaseM } from "../lib/terrain-height";
import { useTwinStore } from "../store/twin-store";
import { fetchBuildings, type Building } from "../services/buildings";
import type { GeoBounds } from "../types/api";
import { SCENE_SCALE } from "./zone-field";

// Vertical exaggeration so footprints read as volumes at diorama scale (illustrative, not to scale)
const HEIGHT_EXAGGERATION = 3;

export function BuildingsLayer({ projector, bounds }: { projector: Projector; bounds: GeoBounds }) {
  const heightmap = useTwinStore((s) => s.heightmap);
  const [buildings, setBuildings] = useState<Building[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    void fetchBuildings(bounds, ctl.signal).then((b) => !ctl.signal.aborted && setBuildings(b));
    return () => ctl.abort();
  }, [bounds]);
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
      // Base on the lowest terrain under the footprint (+0.04 as ObservedTerrain); flat ground when no relief
      if (heightmap) g.translate(0, footprintBaseM(heightmap, b.ring) * SCENE_SCALE + 0.04, 0);
      return g;
    });
    const merged = parts.length ? mergeGeometries(parts) : null;
    parts.forEach((p) => p.dispose());
    return merged;
  }, [buildings, projector, heightmap]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry ? (
    <mesh geometry={geometry} position={[0, heightmap ? 0 : 0.05, 0]} castShadow receiveShadow>
      <meshLambertMaterial color="#d8d2c4" />
    </mesh>
  ) : null;
}
