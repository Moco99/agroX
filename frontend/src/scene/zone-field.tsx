import { useTwinStore } from "../store/twin-store";
import type { Projector } from "../lib/geo";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { color as tokens } from "../styles/tokens";
import { hashString, insidePolygon, seededRandom } from "../lib/geo";

// ─────────────────────────────────────────
// Section: One management zone (coloured plot + instanced plants)
// ─────────────────────────────────────────

export const SCENE_SCALE = 0.01;
// Plant spacing in metres: far wider than real rows on purpose, it keeps the diorama readable and light
const PLANT_SPACING_M = 30;

interface ZoneFieldProps {
  projector: Projector;
  zoneId: string;
  cropId: string;
  ring: [number, number][];
  fill: string;
  canopy: number;
  selected: boolean;
  onSelect: (zoneId: string) => void;
  showPlants?: boolean;
}

function toScene([x, y]: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(x * SCENE_SCALE, 0, -y * SCENE_SCALE);
}

export function ZoneField({
  projector,
  zoneId,
  cropId,
  ring,
  fill,
  canopy,
  selected,
  onSelect,
  showPlants = true,
}: ZoneFieldProps) {
  const dem = useTwinStore((s) => s.heightmap);
  const elevation = useMemo(
    () => (x: number, y: number) => {
      if (!dem) return 0;
      const [wx, ny] = projector.toLocal(dem.bounds.west, dem.bounds.north);
      const [ex, sy] = projector.toLocal(dem.bounds.east, dem.bounds.south);
      const col = Math.max(
        0,
        Math.min(
          dem.width - 1,
          Math.round(((x - wx) / (ex - wx)) * (dem.width - 1)),
        ),
      );
      const row = Math.max(
        0,
        Math.min(
          dem.height - 1,
          Math.round(((ny - y) / (ny - sy)) * (dem.height - 1)),
        ),
      );
      return (
        ((dem.elevations_m[row * dem.width + col] ?? dem.min_m) - dem.min_m) *
          SCENE_SCALE +
        0.05
      );
    },
    [dem, projector],
  );
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const shapeGeometry = useMemo(() => {
    const shape = new THREE.Shape(
      ring.map(([x, y]) => new THREE.Vector2(x * SCENE_SCALE, y * SCENE_SCALE)),
    );
    const geo = new THREE.ShapeGeometry(shape);
    // Shape lives in XY; the field lies on XZ with north towards -Z
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    if (pos)
      for (let i = 0; i < pos.count; i++)
        pos.setY(
          i,
          elevation(pos.getX(i) / SCENE_SCALE, -pos.getZ(i) / SCENE_SCALE),
        );
    geo.computeVertexNormals();
    return geo;
  }, [ring, elevation]);

  const border = useMemo(() => {
    const pts = ring.map((p) => toScene(p).setY(elevation(p[0], p[1]) + 0.03));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [ring, elevation]);

  // Deterministic plant positions inside the polygon (seeded by zone id)
  const positions = useMemo(() => {
    const rand = seededRandom(hashString(zoneId));
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const out: [number, number][] = [];
    for (
      let x = Math.min(...xs) + PLANT_SPACING_M / 2;
      x < Math.max(...xs);
      x += PLANT_SPACING_M
    ) {
      for (
        let y = Math.min(...ys) + PLANT_SPACING_M / 2;
        y < Math.max(...ys);
        y += PLANT_SPACING_M * 0.6
      ) {
        const jx = x + (rand() - 0.5) * 6;
        const jy = y + (rand() - 0.5) * 4;
        if (insidePolygon(jx, jy, ring)) out.push([jx, jy]);
      }
    }
    return out;
  }, [ring, zoneId]);

  const plantGeometry = useMemo(() => {
    // Corn: tall faceted stalk; soybean and cover crops: low rounded bush
    if (cropId === "corn")
      return new THREE.ConeGeometry(0.06, 0.5, 5).translate(0, 0.25, 0);
    return new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.09, 0);
  }, [cropId]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const base = new THREE.Color(fill);
    const c = new THREE.Color();
    const rand = seededRandom(hashString(`${zoneId}:size`));
    // Plants never vanish completely so the zone keeps its crop identity before emergence
    const height = 0.08 + 0.92 * Math.max(0, Math.min(1, canopy));
    positions.forEach(([x, y], i) => {
      const jitter = 0.85 + rand() * 0.3;
      const s = new THREE.Vector3(1, height * jitter, 1).multiplyScalar(
        cropId === "corn" ? 1 : 0.6 + 0.6 * height,
      );
      m.compose(
        new THREE.Vector3(x * SCENE_SCALE, elevation(x, y), -y * SCENE_SCALE),
        q,
        s,
      );
      mesh.setMatrixAt(i, m);
      c.copy(base).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
      mesh.setColorAt(i, c);
    });
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions, fill, canopy, cropId, zoneId, elevation, showPlants]);

  return (
    <group>
      <mesh
        geometry={shapeGeometry}
        position={[0, 0.01, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(zoneId);
        }}
      >
        <meshLambertMaterial color={fill} transparent opacity={0.2} />
      </mesh>
      <lineLoop geometry={border}>
        <lineBasicMaterial
          color={selected ? tokens.accent.bright : "#2F3B2A"}
          linewidth={2}
        />
      </lineLoop>
      {showPlants && <instancedMesh
        ref={meshRef}
        args={[plantGeometry, undefined, Math.max(positions.length, 1)]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(zoneId);
        }}
      >
        <meshLambertMaterial vertexColors={false} />
      </instancedMesh>}
    </group>
  );
}
