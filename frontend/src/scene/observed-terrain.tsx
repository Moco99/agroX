import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useParcelStore } from "../store/parcel-store";
import { useTwinStore } from "../store/twin-store";
import { api } from "../services/api";
import { fetchEsriCanvas } from "../lib/esri-imagery";
import { isPilotFarm } from "../lib/parcel";
import type { Projector } from "../lib/geo";
import type { GeoBounds } from "../types/api";
import { SCENE_SCALE } from "./zone-field";

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
      t.anisotropy = 4;
      if (ctl.signal.aborted) return t.dispose();
      loaded = t;
      setTexture(t);
    };
    const backend = () =>
      hasBasemap ? loadBackendBasemap(api.basemapUrl(farmId), ctl.signal).then(keep) : Promise.reject(new Error("none"));
    setTexture(null);
    // Point parcels get the same Esri imagery as the 2D map; the pilot keeps its NAIP basemap. Failure ends in a tint.
    const job = isPilotFarm(farmId)
      ? backend()
      : fetchEsriCanvas(bounds, ctl.signal).then((c) => keep(new THREE.CanvasTexture(c))).catch(backend);
    job.catch(() => {});
    return () => {
      ctl.abort();
      loaded?.dispose();
    };
  }, [farmId, hasBasemap, bounds]);
  const geometry = useMemo(() => {
    const [west, north] = projector.toLocal(bounds.west, bounds.north);
    const [east, south] = projector.toLocal(bounds.east, bounds.south);
    const segW = heightmap ? heightmap.width - 1 : 1;
    const segH = heightmap ? heightmap.height - 1 : 1;
    const g = new THREE.PlaneGeometry((east - west) * SCENE_SCALE, (north - south) * SCENE_SCALE, segW, segH);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    if (!p) return g;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) + ((east + west) * SCENE_SCALE) / 2);
      p.setZ(i, p.getZ(i) - ((north + south) * SCENE_SCALE) / 2);
      // Flat plane sits just under the zone overlays (y 0.01) so they stay visible
      p.setY(i, heightmap ? ((heightmap.elevations_m[i] ?? heightmap.min_m) - heightmap.min_m) * SCENE_SCALE + 0.04 : 0.005);
    }
    g.computeVertexNormals();
    return g;
  }, [heightmap, projector, bounds]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        key={texture?.uuid ?? "fallback"}
        map={texture}
        color={texture ? "#ffffff" : fallbackColor}
        roughness={0.95}
      />
    </mesh>
  );
}
