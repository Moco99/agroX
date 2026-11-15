import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useParcelStore } from "../store/parcel-store";
import { useTwinStore } from "../store/twin-store";
import { api } from "../services/api";
import type { Projector } from "../lib/geo";
import { SCENE_SCALE } from "./zone-field";

// The DEM and orthophoto use identical geographic bounds; row zero faces north.
export function ObservedTerrain({ projector }: { projector: Projector }) {
  const heightmap = useTwinStore((s) => s.heightmap);
  const farmId = useParcelStore((s) => s.farmId);
  const hasBasemap = useTwinStore((s) => s.imageryMeta !== null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    // No imagery metadata for the parcel: keep the procedural ground instead of requesting a missing image
    if (!hasBasemap) {
      setTexture(null);
      return;
    }
    let active = true;
    let loaded: THREE.Texture | undefined;
    new THREE.TextureLoader().load(
      api.basemapUrl(farmId),
      (t) => {
        loaded = t;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        if (active) setTexture(t);
        else t.dispose();
      },
      undefined,
      () => {},
    );
    return () => {
      active = false;
      loaded?.dispose();
    };
  }, [farmId, hasBasemap]);
  const geometry = useMemo(() => {
    if (!heightmap) return null;
    const b = heightmap.bounds;
    const [west, north] = projector.toLocal(b.west, b.north);
    const [east, south] = projector.toLocal(b.east, b.south);
    const g = new THREE.PlaneGeometry(
      (east - west) * SCENE_SCALE,
      (north - south) * SCENE_SCALE,
      heightmap.width - 1,
      heightmap.height - 1,
    );
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    if (!p) return g;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) + ((east + west) * SCENE_SCALE) / 2);
      p.setZ(i, p.getZ(i) - ((north + south) * SCENE_SCALE) / 2);
      p.setY(
        i,
        ((heightmap.elevations_m[i] ?? heightmap.min_m) - heightmap.min_m) *
          SCENE_SCALE +
          0.04,
      );
    }
    g.computeVertexNormals();
    return g;
  }, [heightmap, projector]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry ? (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        key={texture?.uuid ?? "fallback"}
        map={texture}
        color={texture ? "#ffffff" : "#526741"}
        roughness={0.95}
      />
    </mesh>
  ) : null;
}
