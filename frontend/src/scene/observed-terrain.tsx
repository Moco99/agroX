import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useParcelStore } from "../store/parcel-store";
import { useTwinStore } from "../store/twin-store";
import { api } from "../services/api";
import { fetchEsriCanvas } from "../lib/esri-imagery";
import { isPilotFarm } from "../lib/parcel";
import type { Projector } from "../lib/geo";
import type { GeoBounds } from "../types/api";
import { FLAT_GROUND_Y, SCENE_SCALE, TERRAIN_LIFT } from "./terrain-sampler";

// ─────────────────────────────────────────
// Section: Observed terrain (DEM relief draped with the basemap) plus a soil skirt
// ─────────────────────────────────────────

// Colour of the cut earth around the relief; matches the top stratum of the slab in props.tsx
const SKIRT_COLOR = "#4A3726";

function loadBackendBasemap(url: string, signal: AbortSignal): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => (signal.aborted ? (t.dispose(), reject(new Error("aborted"))) : resolve(t)),
      undefined,
      () => reject(new Error("basemap failed")),
    );
  });
}

// Vertical faces from every border vertex of the relief down to the slab top, so hills do not
// float above the slab edge. Built from the already displaced plane so the two always match.
function skirtGeometry(plane: THREE.PlaneGeometry, columns: number, rows: number): THREE.BufferGeometry {
  const p = plane.attributes.position;
  if (!p) return new THREE.BufferGeometry();
  const at = (i: number, j: number) => j * columns + i;
  // Border loop in a consistent (clockwise seen from above) order so the quads face outward
  const loop: number[] = [];
  for (let i = 0; i < columns; i += 1) loop.push(at(i, 0));
  for (let j = 1; j < rows; j += 1) loop.push(at(columns - 1, j));
  for (let i = columns - 2; i >= 0; i -= 1) loop.push(at(i, rows - 1));
  for (let j = rows - 2; j >= 1; j -= 1) loop.push(at(0, j));
  const positions: number[] = [];
  for (let k = 0; k < loop.length; k += 1) {
    const a = loop[k] ?? 0;
    const b = loop[(k + 1) % loop.length] ?? 0;
    const ax = p.getX(a);
    const ay = p.getY(a);
    const az = p.getZ(a);
    const bx = p.getX(b);
    const by = p.getY(b);
    const bz = p.getZ(b);
    // Two triangles: top edge (a→b) down to the slab (y = 0)
    positions.push(ax, ay, az, ax, 0, az, bx, by, bz);
    positions.push(bx, by, bz, ax, 0, az, bx, 0, bz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

// The DEM and orthophoto use identical geographic bounds; row zero faces north.
// `fallbackBounds` is used when the parcel has no heightmap: a flat plane draped with imagery.
export function ObservedTerrain({
  projector,
  fallbackBounds,
  fallbackColor = "#526741",
}: {
  projector: Projector;
  fallbackBounds: GeoBounds;
  fallbackColor?: string;
}) {
  const heightmap = useTwinStore((s) => s.heightmap);
  const farmId = useParcelStore((s) => s.farmId);
  const hasBasemap = useTwinStore((s) => s.imageryMeta !== null);
  const bounds = heightmap?.bounds ?? fallbackBounds;
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    let loaded: THREE.Texture | undefined;
    const keep = (t: THREE.Texture) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      if (ctl.signal.aborted) return t.dispose();
      loaded = t;
      setTexture(t);
      useTwinStore.setState({ terrainImagery: "ready" });
    };
    const backend = () =>
      hasBasemap ? loadBackendBasemap(api.basemapUrl(farmId), ctl.signal).then(keep) : Promise.reject(new Error("none"));
    setTexture(null);
    useTwinStore.setState({ terrainImagery: "loading" });
    // Point parcels get the same Esri imagery as the 2D map; the pilot keeps its NAIP basemap. Failure ends in a tint.
    const job = isPilotFarm(farmId)
      ? backend()
      : fetchEsriCanvas(bounds, ctl.signal).then((c) => keep(new THREE.CanvasTexture(c))).catch(backend);
    job.catch(() => {
      if (!ctl.signal.aborted) useTwinStore.setState({ terrainImagery: "failed" });
    });
    return () => {
      ctl.abort();
      loaded?.dispose();
    };
  }, [farmId, hasBasemap, bounds]);
  const { geometry, skirt } = useMemo(() => {
    const [west, north] = projector.toLocal(bounds.west, bounds.north);
    const [east, south] = projector.toLocal(bounds.east, bounds.south);
    const segW = heightmap ? heightmap.width - 1 : 1;
    const segH = heightmap ? heightmap.height - 1 : 1;
    const g = new THREE.PlaneGeometry((east - west) * SCENE_SCALE, (north - south) * SCENE_SCALE, segW, segH);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    if (!p) return { geometry: g, skirt: null };
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) + ((east + west) * SCENE_SCALE) / 2);
      p.setZ(i, p.getZ(i) - ((north + south) * SCENE_SCALE) / 2);
      // Flat plane sits just under the zone overlays so they stay visible; relief is lifted off the slab top
      p.setY(
        i,
        heightmap ? ((heightmap.elevations_m[i] ?? heightmap.min_m) - heightmap.min_m) * SCENE_SCALE + TERRAIN_LIFT : FLAT_GROUND_Y,
      );
    }
    g.computeVertexNormals();
    return { geometry: g, skirt: heightmap ? skirtGeometry(g, segW + 1, segH + 1) : null };
  }, [heightmap, projector, bounds]);
  useEffect(
    () => () => {
      geometry.dispose();
      skirt?.dispose();
    },
    [geometry, skirt],
  );
  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial
          key={texture?.uuid ?? "fallback"}
          map={texture}
          color={texture ? "#ffffff" : fallbackColor}
          roughness={0.95}
        />
      </mesh>
      {skirt && (
        <mesh geometry={skirt} receiveShadow>
          <meshStandardMaterial color={SKIRT_COLOR} roughness={1} />
        </mesh>
      )}
    </group>
  );
}
