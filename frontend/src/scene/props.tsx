import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seededRandom } from "../lib/geo";
import { useQuality } from "./quality-context";
import { SCENE_SCALE, type Elevation } from "./terrain-sampler";

// ─────────────────────────────────────────
// Section: Decorative props (slab, pond, road, trees, farmstead, irrigation) — illustrative only
// ─────────────────────────────────────────
//
// None of these objects comes from data except the centre pivot, which only appears when the
// zone's irrigation_level is not NONE. The real irrigation system of a parcel is unknown: the
// pivot is a visual metaphor for "this zone is irrigated in the scenario".

export interface Extent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Scene-space (x, z) → terrain Y, from the local-metre sampler
function sceneY(elevation: Elevation | undefined, x: number, z: number): number {
  return elevation ? elevation(x / SCENE_SCALE, -z / SCENE_SCALE) : 0;
}

function colored(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.deleteAttribute("uv");
  const c = new THREE.Color(hex);
  const n = g.attributes.position?.count ?? 0;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

function mergeColored(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

// ─────────────────────────────────────────
// Section: Diorama slab (soil strata under the cut-out terrain)
// ─────────────────────────────────────────

const STRATA: { depth: number; color: string }[] = [
  { depth: 0.18, color: "#4A3726" },
  { depth: 0.26, color: "#6B5137" },
  { depth: 0.3, color: "#8A7154" },
];

// `pad` is the total margin added to the extent; 0 when the extent already is the textured area
export function Ground({ extent, surface = "#3E5A35", topPlane = true, pad = 6 }: { extent: Extent; surface?: string; topPlane?: boolean; pad?: number }) {
  const w = extent.maxX - extent.minX + pad;
  const d = extent.maxZ - extent.minZ + pad;
  const cx = (extent.maxX + extent.minX) / 2;
  const cz = (extent.maxZ + extent.minZ) / 2;
  let top = 0;
  return (
    <group>
      {STRATA.map((s, i) => {
        const y = top - s.depth / 2;
        top -= s.depth;
        // Each lower layer is a hair smaller so the strata read as steps on the slab edge
        const inset = i * 0.02;
        return (
          <mesh key={s.color} position={[cx, y, cz]} receiveShadow>
            <boxGeometry args={[w - inset, s.depth, d - inset]} />
            <meshStandardMaterial color={s.color} roughness={1} />
          </mesh>
        );
      })}
      {topPlane && (
        <mesh position={[cx, 0.0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={surface} roughness={1} />
        </mesh>
      )}
    </group>
  );
}

// ─────────────────────────────────────────
// Section: Pond (water, sandy shore, reeds)
// ─────────────────────────────────────────

export function Pond({ extent, elevation }: { extent: Extent; elevation?: Elevation }) {
  const x = extent.minX - 1.8;
  const z = extent.maxZ - 1.5;
  const y = sceneY(elevation, x, z);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const quality = useQuality();
  const reeds = useMemo(() => {
    const rand = seededRandom(31);
    return Array.from({ length: 28 }, () => {
      const a = rand() * Math.PI * 2;
      const r = 0.95 + rand() * 0.25;
      return { x: Math.cos(a) * r * 1.25, z: Math.sin(a) * r, h: 0.08 + rand() * 0.1 };
    });
  }, []);
  // A slow shimmer on the water when the scene is animating anyway
  useFrame(({ clock }) => {
    if (water.current && quality.frameloop === "always") water.current.roughness = 0.08 + 0.04 * Math.sin(clock.elapsedTime * 0.8);
  });
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.25, 1, 1]} receiveShadow>
        <circleGeometry args={[1.22, 40]} />
        <meshStandardMaterial color="#B9A47A" roughness={1} />
      </mesh>
      <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.25, 1, 1]}>
        <circleGeometry args={[1.0, 40]} />
        <meshStandardMaterial ref={water} color="#2E6E8E" roughness={0.1} metalness={0.2} envMapIntensity={1.4} />
      </mesh>
      {reeds.map((r, i) => (
        <mesh key={i} position={[r.x, r.h / 2 + 0.01, r.z]} castShadow={quality.shadows}>
          <coneGeometry args={[0.012, r.h, 4]} />
          <meshStandardMaterial color="#6E7F3A" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────
// Section: Gravel road with wheel ruts
// ─────────────────────────────────────────

export function Road({ extent, elevation }: { extent: Extent; elevation?: Elevation }) {
  const len = extent.maxZ - extent.minZ + 6;
  const x = extent.maxX + 0.9;
  const cz = (extent.maxZ + extent.minZ) / 2;
  const y = Math.max(sceneY(elevation, x, extent.minZ), sceneY(elevation, x, extent.maxZ), sceneY(elevation, x, cz)) + 0.012;
  return (
    <group position={[x, y, cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.5, len]} />
        <meshStandardMaterial color="#9A8E76" roughness={1} />
      </mesh>
      {[-0.1, 0.1].map((dx) => (
        <mesh key={dx} position={[dx, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.06, len]} />
          <meshStandardMaterial color="#7C705B" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────
// Section: Windbreak trees (two instanced species, seeded)
// ─────────────────────────────────────────

function coniferGeometry(): THREE.BufferGeometry {
  return mergeColored([
    colored(new THREE.CylinderGeometry(0.03, 0.04, 0.18, 5).translate(0, 0.09, 0), "#5A4030"),
    colored(new THREE.ConeGeometry(0.3, 0.5, 7).translate(0, 0.38, 0), "#2F5D34"),
    colored(new THREE.ConeGeometry(0.23, 0.42, 7).translate(0, 0.62, 0), "#346839"),
    colored(new THREE.ConeGeometry(0.15, 0.34, 7).translate(0, 0.84, 0), "#3A7240"),
  ]);
}

function deciduousGeometry(): THREE.BufferGeometry {
  return mergeColored([
    colored(new THREE.CylinderGeometry(0.035, 0.05, 0.36, 5).translate(0, 0.18, 0), "#5E4532"),
    colored(new THREE.IcosahedronGeometry(0.3, 1).translate(0, 0.58, 0), "#4D7F38"),
    colored(new THREE.IcosahedronGeometry(0.2, 1).translate(0.16, 0.5, 0.08), "#568A3E"),
    colored(new THREE.IcosahedronGeometry(0.19, 1).translate(-0.14, 0.52, -0.1), "#47763A"),
  ]);
}

interface TreeSpot {
  x: number;
  z: number;
  h: number;
  conifer: boolean;
  shade: number;
}

export function Trees({ extent, seed = 7, elevation }: { extent: Extent; seed?: number; elevation?: Elevation }) {
  const quality = useQuality();
  const spots = useMemo(() => {
    const rand = seededRandom(seed);
    const out: TreeSpot[] = [];
    // Windbreak along the west and south edges, as is common on Corn Belt farmsteads
    for (let z = extent.minZ - 2.5; z <= extent.maxZ + 2.5; z += 0.55) {
      out.push({ x: extent.minX - 2.6 + rand() * 0.4, z: z + rand() * 0.2, h: 0.75 + rand() * 0.5, conifer: rand() < 0.65, shade: rand() });
    }
    for (let x = extent.minX - 2; x <= extent.maxX + 2.5; x += 0.6) {
      out.push({ x: x + rand() * 0.2, z: extent.maxZ + 2.6 + rand() * 0.4, h: 0.65 + rand() * 0.5, conifer: rand() < 0.35, shade: rand() });
    }
    // A loose second row so the belt has depth
    for (let z = extent.minZ - 2; z <= extent.maxZ + 2; z += 1.1) {
      if (rand() < 0.7) out.push({ x: extent.minX - 3.3 + rand() * 0.3, z, h: 0.6 + rand() * 0.4, conifer: false, shade: rand() });
    }
    return out;
  }, [extent, seed]);
  const conifers = useMemo(() => spots.filter((s) => s.conifer), [spots]);
  const broadleaf = useMemo(() => spots.filter((s) => !s.conifer), [spots]);
  const coniferGeo = useMemo(coniferGeometry, []);
  const broadleafGeo = useMemo(deciduousGeometry, []);
  useEffect(
    () => () => {
      coniferGeo.dispose();
      broadleafGeo.dispose();
    },
    [coniferGeo, broadleafGeo],
  );
  return (
    <>
      <TreeInstances geometry={coniferGeo} spots={conifers} elevation={elevation} shadows={quality.shadows} />
      <TreeInstances geometry={broadleafGeo} spots={broadleaf} elevation={elevation} shadows={quality.shadows} />
    </>
  );
}

function TreeInstances({
  geometry,
  spots,
  elevation,
  shadows,
}: {
  geometry: THREE.BufferGeometry;
  spots: TreeSpot[];
  elevation?: Elevation;
  shadows: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.shade * Math.PI * 2);
      m.compose(new THREE.Vector3(s.x, sceneY(elevation, s.x, s.z), s.z), q, new THREE.Vector3(s.h, s.h, s.h));
      mesh.setMatrixAt(i, m);
      // Slight per-tree brightness/hue variation so the belt is not a cloned row
      mesh.setColorAt(i, c.setHSL(0.27 + (s.shade - 0.5) * 0.05, 0.25, 0.85 + s.shade * 0.3));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [spots, elevation, invalidate]);
  if (spots.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, spots.length]} castShadow={shadows} receiveShadow={shadows}>
      <meshStandardMaterial vertexColors roughness={0.85} flatShading />
    </instancedMesh>
  );
}

// ─────────────────────────────────────────
// Section: Farmstead (barn, silo, grain bins, house, fence)
// ─────────────────────────────────────────

function gableRoof(width: number, depth: number, rise: number): THREE.BufferGeometry {
  const shape = new THREE.Shape([new THREE.Vector2(-width / 2, 0), new THREE.Vector2(width / 2, 0), new THREE.Vector2(0, rise)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Footprint radius of the farmstead group; a candidate spot is rejected if an observed building is this close
const FARMSTEAD_CLEARANCE = 1.6;

// Candidate spots clockwise from the north-east corner, outside the fields and off the road and pond
function farmsteadCandidates(extent: Extent): [number, number][] {
  return [
    [extent.maxX + 2.1, extent.minZ + 1.2],
    [extent.maxX + 2.1, extent.maxZ - 1.4],
    [extent.minX + 1.4, extent.minZ - 2.2],
    [extent.maxX - 1.6, extent.minZ - 2.2],
  ];
}

// Decorative farmstead, placed where no observed building stands. Real footprints come from the
// BuildingsLayer; drawing a barn on top of a real house would contradict the imagery, so `avoid`
// lists their scene positions and the group disappears when every candidate spot is taken.
export function Farmstead({ extent, elevation, avoid = [] }: { extent: Extent; elevation?: Elevation; avoid?: [number, number][] }) {
  const quality = useQuality();
  const spot = useMemo(
    () =>
      farmsteadCandidates(extent).find(([cx, cz]) => avoid.every(([bx, bz]) => Math.hypot(bx - cx, bz - cz) > FARMSTEAD_CLEARANCE)) ??
      null,
    [extent, avoid],
  );
  const x = spot?.[0] ?? 0;
  const z = spot?.[1] ?? 0;
  const y = sceneY(elevation, x, z);
  const barnRoof = useMemo(() => gableRoof(0.78, 1.1, 0.34), []);
  const houseRoof = useMemo(() => gableRoof(0.56, 0.62, 0.22), []);
  useEffect(
    () => () => {
      barnRoof.dispose();
      houseRoof.dispose();
    },
    [barnRoof, houseRoof],
  );
  const s = quality.shadows;
  if (!spot) return null;
  return (
    <group position={[x, y, z]}>
      {/* Barn */}
      <group position={[0.1, 0, 0]}>
        <mesh position={[0, 0.2, 0]} castShadow={s} receiveShadow={s}>
          <boxGeometry args={[0.7, 0.4, 1.1]} />
          <meshStandardMaterial color="#9B2F25" roughness={0.8} />
        </mesh>
        <mesh geometry={barnRoof} position={[0, 0.4, 0]} castShadow={s}>
          <meshStandardMaterial color="#4B4F55" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[-0.351, 0.15, 0]}>
          <boxGeometry args={[0.01, 0.28, 0.32]} />
          <meshStandardMaterial color="#EDE6D6" roughness={0.9} />
        </mesh>
      </group>
      {/* Silo */}
      <group position={[0.65, 0, -0.35]}>
        <mesh position={[0, 0.45, 0]} castShadow={s}>
          <cylinderGeometry args={[0.16, 0.16, 0.9, 16]} />
          <meshStandardMaterial color="#2F4D6B" roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.9, 0]} castShadow={s}>
          <sphereGeometry args={[0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#C9CCD1" roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
      {/* Corrugated grain bins */}
      {[0.35, 0.75].map((dz) => (
        <group key={dz} position={[0.7, 0, dz]}>
          <mesh position={[0, 0.16, 0]} castShadow={s}>
            <cylinderGeometry args={[0.17, 0.17, 0.32, 20]} />
            <meshStandardMaterial color="#B7BCC2" roughness={0.35} metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.37, 0]} castShadow={s}>
            <coneGeometry args={[0.18, 0.1, 20]} />
            <meshStandardMaterial color="#A6ABB1" roughness={0.35} metalness={0.7} />
          </mesh>
        </group>
      ))}
      {/* House */}
      <group position={[-0.65, 0, 0.7]}>
        <mesh position={[0, 0.13, 0]} castShadow={s} receiveShadow={s}>
          <boxGeometry args={[0.5, 0.26, 0.56]} />
          <meshStandardMaterial color="#E8E2D4" roughness={0.9} />
        </mesh>
        <mesh geometry={houseRoof} position={[0, 0.26, 0]} castShadow={s}>
          <meshStandardMaterial color="#5B3A2E" roughness={0.8} />
        </mesh>
      </group>
      {/* Yard */}
      <mesh position={[0.05, 0.004, 0.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2.2, 2.2]} />
        <meshStandardMaterial color="#A39B84" roughness={1} />
      </mesh>
    </group>
  );
}

// Fence posts around the farm outline: cheap detail that sells the scale
export function Fence({ extent, elevation }: { extent: Extent; elevation?: Elevation }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const posts = useMemo(() => {
    const out: [number, number][] = [];
    const step = 0.35;
    const m = 0.25;
    for (let x = extent.minX - m; x <= extent.maxX + m; x += step) out.push([x, extent.minZ - m], [x, extent.maxZ + m]);
    for (let z = extent.minZ - m + step; z < extent.maxZ + m; z += step) out.push([extent.minX - m, z], [extent.maxX + m, z]);
    return out;
  }, [extent]);
  const geometry = useMemo(() => new THREE.BoxGeometry(0.018, 0.09, 0.018).translate(0, 0.045, 0), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => {
      m.makeTranslation(x, sceneY(elevation, x, z), z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [posts, elevation, invalidate]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, posts.length]}>
      <meshStandardMaterial color="#7A6A55" roughness={1} />
    </instancedMesh>
  );
}

// ─────────────────────────────────────────
// Section: Centre pivot (only for irrigated zones; spray only while irrigation is applied)
// ─────────────────────────────────────────

const PIVOT_HEIGHT = 0.72;
const PIVOT_TOWERS = 4;

export function CenterPivot({
  position,
  radius,
  active,
}: {
  position: [number, number, number];
  radius: number;
  active: boolean;
}) {
  const quality = useQuality();
  const arm = useRef<THREE.Group>(null);
  const spray = useRef<THREE.MeshBasicMaterial>(null);
  // Start each pivot at a different angle so several zones do not look synchronised
  const startAngle = useMemo(() => (position[0] * 7.3 + position[2] * 3.1) % (Math.PI * 2), [position]);
  useFrame(({ clock }, delta) => {
    if (arm.current && active && quality.frameloop === "always") arm.current.rotation.y -= delta * 0.12;
    if (spray.current) spray.current.opacity = active ? 0.22 + 0.06 * Math.sin(clock.elapsedTime * 5) : 0;
  });
  const towers = Array.from({ length: PIVOT_TOWERS }, (_, i) => ((i + 1) / PIVOT_TOWERS) * radius);
  const s = quality.shadows;
  return (
    <group position={position}>
      {/* Pivot point */}
      <mesh position={[0, PIVOT_HEIGHT / 2, 0]} castShadow={s}>
        <cylinderGeometry args={[0.03, 0.07, PIVOT_HEIGHT, 6]} />
        <meshStandardMaterial color="#9AA3AD" roughness={0.4} metalness={0.7} />
      </mesh>
      <group ref={arm} rotation={[0, startAngle, 0]}>
        {/* Main pipe along +X */}
        <mesh position={[radius / 2, PIVOT_HEIGHT, 0]} rotation={[0, 0, Math.PI / 2]} castShadow={s}>
          <cylinderGeometry args={[0.012, 0.012, radius, 6]} />
          <meshStandardMaterial color="#C7CDD3" roughness={0.3} metalness={0.8} />
        </mesh>
        {/* Truss rods under the pipe */}
        <mesh position={[radius / 2, PIVOT_HEIGHT - 0.07, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.004, 0.004, radius, 4]} />
          <meshStandardMaterial color="#8E979F" roughness={0.5} metalness={0.6} />
        </mesh>
        {towers.map((tx) => (
          <group key={tx} position={[tx, 0, 0]}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[0, PIVOT_HEIGHT / 2, side * 0.06]} rotation={[side * 0.17, 0, 0]} castShadow={s}>
                <cylinderGeometry args={[0.008, 0.008, PIVOT_HEIGHT, 4]} />
                <meshStandardMaterial color="#9AA3AD" roughness={0.4} metalness={0.7} />
              </mesh>
            ))}
            {[-1, 1].map((side) => (
              <mesh key={`w${side}`} position={[0, 0.04, side * 0.12]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.04, 0.04, 0.025, 10]} />
                <meshStandardMaterial color="#2B2B2B" roughness={0.9} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Water curtain under the span; additive so it reads as mist over any crop colour */}
        <mesh position={[radius / 2, PIVOT_HEIGHT / 2, 0]} visible={active}>
          <boxGeometry args={[radius, PIVOT_HEIGHT * 0.95, 0.16]} />
          <meshBasicMaterial
            ref={spray}
            color="#9FD8FF"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
