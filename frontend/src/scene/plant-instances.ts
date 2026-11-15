import * as THREE from "three";
import type { PlantSpot } from "../lib/crop-visuals";
import { SCENE_SCALE, type Elevation } from "./terrain-sampler";

// ─────────────────────────────────────────
// Section: Instance matrices and colours for one zone's plants
// ─────────────────────────────────────────

// The subset of InstancedMesh this writer needs, so it can be exercised in tests without a renderer
export interface InstanceTarget {
  setMatrixAt(index: number, matrix: THREE.Matrix4): void;
  setColorAt(index: number, color: THREE.Color): void;
}

// Soil sits this far above the terrain; plants stand on the soil, not on the imagery
export const SOIL_LIFT = 0.012;

// Writes every plant's transform and brightness jitter. Hue comes from the stage colours in the
// shader; only the per-plant brightness varies here so instanced rows do not look stamped.
export function writePlantInstances(target: InstanceTarget, spots: PlantSpot[], elevation: Elevation, sizeBoost: number): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    pos.set(s.x * SCENE_SCALE, elevation(s.x, s.y) + SOIL_LIFT, -s.y * SCENE_SCALE);
    q.setFromAxisAngle(up, s.heading);
    scale.setScalar(s.scale * sizeBoost);
    m.compose(pos, q, scale);
    target.setMatrixAt(i, m);
    const v = 0.86 + ((s.scale - 0.82) / 0.36) * 0.22;
    target.setColorAt(i, c.setRGB(v, v, v));
  });
}

// Full update of one InstancedMesh: transforms, colours, draw count, upload flags and bounds. Called
// for every mesh instance R3F creates, because a rebuilt mesh starts with identity matrices.
export function syncPlantMesh(mesh: THREE.InstancedMesh, spots: PlantSpot[], elevation: Elevation, sizeBoost: number): void {
  writePlantInstances(mesh, spots, elevation, sizeBoost);
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}
