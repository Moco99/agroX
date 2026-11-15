import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { growthFormFor, rowLayout, rowsRunAlongY, soilTone, stageVisual } from "../lib/crop-visuals";
import { hashString, insidePolygon, type Projector } from "../lib/geo";
import { color as tokens } from "../styles/tokens";
import type { PhenoStage } from "../types/api";
import { canopyColors, plantGeometry } from "./plant-geometry";
import { SOIL_LIFT, syncPlantMesh } from "./plant-instances";
import { createPlantMaterials, createPlantUniforms } from "./plant-material";
import { useQuality } from "./quality-context";
import { SCENE_SCALE, useElevation, type Elevation } from "./terrain-sampler";

// Re-exported for modules that still import the scale from here
export { SCENE_SCALE };

// ─────────────────────────────────────────
// Section: One management zone (furrowed soil + instanced crop rows + layer outline)
// ─────────────────────────────────────────

// Drawn row and plant spacing in metres at full density. Far wider than real rows on purpose:
// the diorama is illustrative and must stay light enough for a laptop.
const ROW_SPACING_M = 14;
const PLANT_SPACING_M = 9;
const SOIL_GRID = 28;
// How strongly the active layer colour tints plants and soil. Soil and outline carry the layer;
// plants keep most of their natural colour so corn still reads as corn under a blue moisture ramp.
const PLANT_TINT = 0.2;
const SOIL_TINT = 0.38;

interface ZoneFieldProps {
  projector: Projector;
  zoneId: string;
  cropId: string;
  ring: [number, number][];
  fill: string;
  canopy: number;
  stage?: PhenoStage | null;
  // TwinState.soil_water_fraction for the day (null = no state)
  soilWater?: number | null;
  selected: boolean;
  onSelect: (zoneId: string) => void;
  showPlants?: boolean;
}

export function ZoneField({
  projector,
  zoneId,
  cropId,
  ring,
  fill,
  canopy,
  stage = null,
  soilWater = null,
  selected,
  onSelect,
  showPlants = true,
}: ZoneFieldProps) {
  const elevation = useElevation(projector);
  const visual = stageVisual(stage, canopy);
  const outline = useMemo(
    () => ring.map(([x, y]) => new THREE.Vector3(x * SCENE_SCALE, elevation(x, y) + SOIL_LIFT + 0.02, -y * SCENE_SCALE)),
    [ring, elevation],
  );
  return (
    <group>
      <ZoneSoil
        ring={ring}
        elevation={elevation}
        fill={fill}
        soilWater={soilWater}
        furrowed={showPlants}
        onClick={() => onSelect(zoneId)}
      />
      {outline.length > 2 && (
        <Line
          points={[...outline, outline[0] ?? outline[1]!]}
          color={selected ? tokens.accent.bright : fill}
          lineWidth={selected ? 3 : 1.6}
          // Unmapped so bloom catches the selected outline
          toneMapped={!selected}
        />
      )}
      {showPlants && (
        <CropRows zoneId={zoneId} cropId={cropId} ring={ring} elevation={elevation} fill={fill} visual={visual} />
      )}
    </group>
  );
}

// ─────────────────────────────────────────
// Section: Soil (grid clipped to the zone and draped on the relief; colour = soil water metaphor)
// ─────────────────────────────────────────

let furrowTexture: THREE.CanvasTexture | null = null;

// Grayscale furrow stripes, one ridge per texture repeat; colour comes from the material
function getFurrowTexture(): THREE.CanvasTexture {
  if (furrowTexture) return furrowTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Ridge profile across U, clods as noise
        const ridge = 0.5 + 0.5 * Math.cos((x / size) * Math.PI * 2);
        const v = Math.round(255 * (0.62 + 0.3 * ridge + (noise() - 0.5) * 0.16));
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  furrowTexture = new THREE.CanvasTexture(canvas);
  furrowTexture.wrapS = THREE.RepeatWrapping;
  furrowTexture.wrapT = THREE.RepeatWrapping;
  furrowTexture.colorSpace = THREE.SRGBColorSpace;
  furrowTexture.anisotropy = 4;
  return furrowTexture;
}

function nearestOnRing(x: number, y: number, ring: [number, number][]): [number, number] {
  let best: [number, number] = [x, y];
  let bestD = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [px, py];
    }
  }
  return best;
}

// A ShapeGeometry only has boundary vertices and would cut through hills; a clipped grid follows the relief
function drapedZoneGeometry(ring: [number, number][], elevation: Elevation): THREE.BufferGeometry {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const alongY = rowsRunAlongY(ring);
  const n = SOIL_GRID;
  const verts: { p: [number, number]; inside: boolean }[] = [];
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const x = minX + ((maxX - minX) * i) / n;
      const y = minY + ((maxY - minY) * j) / n;
      const inside = insidePolygon(x, y, ring);
      // Outside vertices snap to the boundary so edge cells close the polygon instead of leaving a staircase
      verts.push({ p: inside ? [x, y] : nearestOnRing(x, y, ring), inside });
    }
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const push = (k: number) => {
    const v = verts[k];
    if (!v) return;
    const [x, y] = v.p;
    positions.push(x * SCENE_SCALE, elevation(x, y) + SOIL_LIFT, -y * SCENE_SCALE);
    // U runs across the rows so each texture repeat is one furrow
    const across = alongY ? x : y;
    const along = alongY ? y : x;
    uvs.push(across / ROW_SPACING_M, along / 40);
  };
  const idx = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i, j + 1);
      const d = idx(i + 1, j + 1);
      // Winding chosen so faces point up after the y → -z flip
      for (const tri of [
        [a, b, c],
        [b, d, c],
      ]) {
        if (tri.some((k) => verts[k]?.inside)) tri.forEach(push);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

function ZoneSoil({
  ring,
  elevation,
  fill,
  soilWater,
  furrowed,
  onClick,
}: {
  ring: [number, number][];
  elevation: Elevation;
  fill: string;
  soilWater: number | null;
  furrowed: boolean;
  onClick: () => void;
}) {
  const geometry = useMemo(() => drapedZoneGeometry(ring, elevation), [ring, elevation]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);
  const tone = soilTone(soilWater);
  const target = useMemo(() => new THREE.Color(tone.hex).lerp(new THREE.Color(fill), SOIL_TINT), [tone.hex, fill]);
  const overlay = useMemo(() => new THREE.Color(fill), [fill]);

  useEffect(() => invalidate(), [target, invalidate]);
  // Snap to the goal only when a material mounts (switching between the furrowed and overlay
  // branches creates a new one). No `color` prop afterwards: it would re-apply the target on every
  // render and the eased lerp below would never be visible.
  useLayoutEffect(() => {
    const m = materialRef.current;
    if (!m) return;
    m.color.copy(furrowed ? target : overlay);
    if (furrowed) m.roughness = tone.roughness;
    invalidate();
    // Mount-only per branch on purpose: later target changes are eased in useFrame
  }, [furrowed]);
  // Ease the soil colour so a rain day darkens the field gradually while the timeline plays
  useFrame((_, delta) => {
    const m = materialRef.current;
    if (!m) return;
    const goal = furrowed ? target : overlay;
    if (m.color.equals(goal)) return;
    m.color.lerp(goal, 1 - Math.exp(-delta * 6));
    if (Math.abs(m.color.r - goal.r) + Math.abs(m.color.g - goal.g) + Math.abs(m.color.b - goal.b) < 0.003) m.color.copy(goal);
    if (furrowed) m.roughness = tone.roughness;
    invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {furrowed ? (
        <meshStandardMaterial ref={materialRef} map={getFurrowTexture()} metalness={0} />
      ) : (
        // No declared crop: a translucent layer tint keeps the real imagery visible underneath
        <meshStandardMaterial ref={materialRef} transparent opacity={0.28} depthWrite={false} roughness={1} />
      )}
    </mesh>
  );
}

// ─────────────────────────────────────────
// Section: Crop rows (one InstancedMesh per zone; stage drives shader uniforms, eased per frame)
// ─────────────────────────────────────────

function CropRows({
  zoneId,
  cropId,
  ring,
  elevation,
  fill,
  visual,
}: {
  zoneId: string;
  cropId: string;
  ring: [number, number][];
  elevation: Elevation;
  fill: string;
  visual: ReturnType<typeof stageVisual>;
}) {
  const quality = useQuality();
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [mesh, setMesh] = useState<THREE.InstancedMesh | null>(null);
  const attachMesh = useCallback((m: THREE.InstancedMesh | null) => {
    meshRef.current = m;
    setMesh(m);
  }, []);
  const form = growthFormFor(cropId);
  const geometry = useMemo(() => plantGeometry(form, cropId), [form, cropId]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => createPlantUniforms(), []);
  const { material, depth } = useMemo(() => createPlantMaterials(uniforms), [uniforms]);
  useEffect(
    () => () => {
      material.dispose();
      depth.dispose();
    },
    [material, depth],
  );

  const spots = useMemo(() => {
    // Lower tiers draw fewer, slightly larger plants so the field still reads as covered
    const k = 1 / Math.sqrt(quality.plantDensity);
    return rowLayout(ring, {
      rowSpacingM: ROW_SPACING_M * k,
      plantSpacingM: PLANT_SPACING_M * k,
      maxPlants: quality.maxPlantsPerZone,
      seed: hashString(zoneId),
    });
  }, [ring, zoneId, quality.plantDensity, quality.maxPlantsPerZone]);

  // The write is keyed on the mesh object itself: a crop change (new form or geometry) or a new plant
  // count makes R3F build a fresh InstancedMesh, which starts with identity matrices (every plant
  // at the origin). Tracking the instance through a callback ref re-runs the write for each new
  // mesh, whatever prop caused the rebuild.
  useLayoutEffect(() => {
    if (!mesh) return;
    // Lower tiers draw fewer, slightly larger plants so the field still reads as covered
    syncPlantMesh(mesh, spots, elevation, 1 + (1 - quality.plantDensity) * 0.5);
    invalidate();
  }, [mesh, spots, elevation, quality.plantDensity, invalidate]);

  // Targets for the eased uniforms
  const colors = canopyColors(form);
  const leaf = useMemo(() => new THREE.Color(colors.leaf), [colors.leaf]);
  const senescent = useMemo(() => new THREE.Color(colors.senescent), [colors.senescent]);
  const tint = useMemo(() => new THREE.Color(fill), [fill]);
  useEffect(() => {
    uniforms.uLeaf.value.copy(leaf);
    uniforms.uSenescent.value.copy(senescent);
    invalidate();
  }, [leaf, senescent, uniforms, invalidate]);
  useEffect(() => invalidate(), [visual.growth, visual.reproductive, visual.senescence, tint, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const ease = (u: { value: number }, goal: number, rate: number) => {
      const next = THREE.MathUtils.damp(u.value, goal, rate, dt);
      u.value = Math.abs(next - goal) < 0.001 ? goal : next;
      return u.value !== goal;
    };
    let moving = false;
    moving = ease(uniforms.uGrowth, visual.visible ? visual.growth : 0, 4) || moving;
    moving = ease(uniforms.uRepro, visual.reproductive, 3) || moving;
    moving = ease(uniforms.uSenescence, visual.senescence, 3) || moving;
    moving = ease(uniforms.uTintMix, PLANT_TINT, 4) || moving;
    // Taller plants sway more; stubble and seedlings stay still
    moving = ease(uniforms.uWind, quality.wind && !visual.stubble ? 0.05 : 0, 2) || moving;
    if (!uniforms.uTint.value.equals(tint)) {
      uniforms.uTint.value.lerp(tint, 1 - Math.exp(-dt * 6));
      const t = uniforms.uTint.value;
      if (Math.abs(t.r - tint.r) + Math.abs(t.g - tint.g) + Math.abs(t.b - tint.b) < 0.003) t.copy(tint);
      moving = true;
    }
    if (quality.wind) uniforms.uTime.value += dt;
    const live = meshRef.current;
    // Skip drawing fully collapsed plants (pre-planting) instead of rendering degenerate triangles
    if (live) live.visible = uniforms.uGrowth.value > 0.002;
    if (moving) invalidate();
  });

  return (
    <instancedMesh
      key={`${form}:${spots.length}`}
      ref={attachMesh}
      args={[geometry, material, Math.max(spots.length, 1)]}
      customDepthMaterial={depth}
      castShadow={quality.shadows}
      receiveShadow={quality.shadows}
      // Thousands of instances are not worth raycasting; clicks fall through to the soil below
      raycast={() => null}
    />
  );
}
