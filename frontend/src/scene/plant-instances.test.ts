import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { rowLayout } from "../lib/crop-visuals";
import { syncPlantMesh, writePlantInstances, type InstanceTarget } from "./plant-instances";

const square: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 600],
  [0, 600],
];

// Captures what an InstancedMesh would receive so the layout can be asserted without WebGL
function recorder() {
  const positions: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  const target: InstanceTarget = {
    setMatrixAt: (i, m) => {
      positions[i] = new THREE.Vector3().setFromMatrixPosition(m);
    },
    setColorAt: (i, c) => {
      colors[i] = c.clone();
    },
  };
  return { target, positions, colors };
}

describe("writePlantInstances", () => {
  it("spreads plants over the zone instead of stacking them at the origin", () => {
    const spots = rowLayout(square, { rowSpacingM: 20, plantSpacingM: 15, maxPlants: 2000, seed: 3 });
    const { target, positions, colors } = recorder();
    writePlantInstances(target, spots, () => 0.04, 1);
    expect(positions).toHaveLength(spots.length);
    const xs = positions.map((p) => p.x);
    const zs = positions.map((p) => p.z);
    // Scene scale is 0.01: a 400 x 600 m zone must span roughly 4 x 6 units
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);
    expect(Math.min(...zs) - Math.max(...zs)).toBeLessThan(-5);
    expect(positions.every((p) => Math.abs(p.y - 0.052) < 1e-6)).toBe(true);
    expect(colors).toHaveLength(spots.length);
  });

  it("stands plants on the sampled terrain height", () => {
    const spots = rowLayout(square, { rowSpacingM: 100, plantSpacingM: 100, maxPlants: 50, seed: 1 });
    const { target, positions } = recorder();
    writePlantInstances(target, spots, (x) => x * 0.001, 1);
    const east = positions.filter((_, i) => spots[i]!.x > 300);
    const west = positions.filter((_, i) => spots[i]!.x < 100);
    expect(Math.min(...east.map((p) => p.y))).toBeGreaterThan(Math.max(...west.map((p) => p.y)));
  });
});

// Regression for the crop-switch bug: R3F rebuilds the InstancedMesh when the crop's geometry
// changes, and the fresh mesh has identity matrices until something rewrites them
describe("syncPlantMesh on a crop switch", () => {
  const spread = (mesh: THREE.InstancedMesh) => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const xs: number[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      xs.push(p.setFromMatrixPosition(m).x);
    }
    return Math.max(...xs) - Math.min(...xs);
  };

  it("a rebuilt mesh stacks every plant at the origin until it is synced", () => {
    const spots = rowLayout(square, { rowSpacingM: 20, plantSpacingM: 15, maxPlants: 2000, seed: 3 });
    const material = new THREE.MeshStandardMaterial();
    const corn = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 1), material, spots.length);
    syncPlantMesh(corn, spots, () => 0, 1);
    expect(spread(corn)).toBeGreaterThan(3);

    // Same spots, new crop geometry: what R3F does when `args` change
    const soybean = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1), material, spots.length);
    expect(spread(soybean)).toBe(0);
    syncPlantMesh(soybean, spots, () => 0, 1);
    expect(spread(soybean)).toBeGreaterThan(3);
    expect(soybean.count).toBe(spots.length);
    expect(soybean.instanceColor).not.toBeNull();
    expect(soybean.boundingSphere?.radius ?? 0).toBeGreaterThan(1);
  });
});
