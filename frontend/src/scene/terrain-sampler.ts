import { useMemo } from "react";
import type { Projector } from "../lib/geo";
import { sampleHeightM } from "../lib/terrain-height";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Shared terrain height in scene units (same origin as ObservedTerrain)
// ─────────────────────────────────────────

export const SCENE_SCALE = 0.01;
// ObservedTerrain lifts the relief by this much so it never z-fights the slab top
export const TERRAIN_LIFT = 0.04;
// Height of the flat imagery plane when the parcel has no relief
export const FLAT_GROUND_Y = 0.005;

export type Elevation = (x: number, y: number) => number;

// Local metres (x east, y north) → scene Y of the terrain surface; bilinear so props sit on the mesh
export function useElevation(projector: Projector): Elevation {
  const dem = useTwinStore((s) => s.heightmap);
  return useMemo<Elevation>(() => {
    if (!dem) return () => FLAT_GROUND_Y;
    return (x, y) => {
      const [lon, lat] = projector.fromLocal(x, y);
      return sampleHeightM(dem, lon, lat) * SCENE_SCALE + TERRAIN_LIFT;
    };
  }, [dem, projector]);
}
