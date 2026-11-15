import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { seededRandom } from "../lib/geo";

// ─────────────────────────────────────────
// Section: Decorative props (pond, road, trees) — illustrative only
// ─────────────────────────────────────────

interface Extent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function Ground({ extent, surface = "#3E5A35", topPlane = true }: { extent: Extent; surface?: string; topPlane?: boolean }) {
  const w = extent.maxX - extent.minX;
  const d = extent.maxZ - extent.minZ;
  const cx = (extent.maxX + extent.minX) / 2;
  const cz = (extent.maxZ + extent.minZ) / 2;
  return (
    <group>
      {/* Soil slab under the farm gives the diorama its "cut-out" look */}
      <mesh position={[cx, -0.35, cz]}>
        <boxGeometry args={[w + 6, 0.7, d + 6]} />
        <meshLambertMaterial color="#5B4632" />
      </mesh>
      {topPlane && (
        <mesh position={[cx, 0.0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w + 6, d + 6]} />
          <meshLambertMaterial color={surface} />
        </mesh>
      )}
    </group>
  );
}

export function Pond({ extent }: { extent: Extent }) {
  return (
    <mesh position={[extent.minX - 1.8, 0.02, extent.maxZ - 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.0, 24]} />
      <meshPhongMaterial color="#3A7CA5" shininess={80} transparent opacity={0.9} />
    </mesh>
  );
}

export function Road({ extent }: { extent: Extent }) {
  const len = extent.maxZ - extent.minZ + 6;
  return (
    <mesh position={[extent.maxX + 0.9, 0.015, (extent.maxZ + extent.minZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.45, len]} />
      <meshLambertMaterial color="#8A7F6A" />
    </mesh>
  );
}

export function Trees({ extent, seed = 7 }: { extent: Extent; seed?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const positions = useMemo(() => {
    const rand = seededRandom(seed);
    const out: [number, number, number][] = [];
    // Windbreak along the west and south edges, as is common on Corn Belt farmsteads
    for (let z = extent.minZ - 2.5; z <= extent.maxZ + 2.5; z += 0.7) {
      out.push([extent.minX - 2.6 + rand() * 0.4, z + rand() * 0.2, 0.7 + rand() * 0.5]);
    }
    for (let x = extent.minX - 2; x <= extent.maxX + 2.5; x += 0.8) {
      out.push([x + rand() * 0.2, extent.maxZ + 2.6 + rand() * 0.4, 0.6 + rand() * 0.5]);
    }
    return out;
  }, [extent, seed]);
  const geometry = useMemo(() => new THREE.ConeGeometry(0.28, 1, 6).translate(0, 0.5, 0), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    positions.forEach(([x, z, h], i) => {
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, positions.length]}>
      <meshLambertMaterial color="#2E5E36" />
    </instancedMesh>
  );
}

// ─────────────────────────────────────────
// Section: Irrigation (pipes + animated sprinklers, only when irrigation is active)
// ─────────────────────────────────────────

export function Sprinkler({ position, active }: { position: [number, number, number]; active: boolean }) {
  const spray = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (spray.current && active) spray.current.rotation.y += delta * 1.5;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.4, 6]} />
        <meshLambertMaterial color="#AEB6BF" />
      </mesh>
      {active && (
        <mesh ref={spray} position={[0, 0.32, 0]}>
          <coneGeometry args={[0.7, 0.3, 16, 1, true]} />
          <meshBasicMaterial color="#7FC8F8" transparent opacity={0.28} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
