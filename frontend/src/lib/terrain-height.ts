import type { GeoBounds, Heightmap } from "../types/api";

// ─────────────────────────────────────────
// Section: Terrain height sampling (same grid and vertical origin as ObservedTerrain)
// ─────────────────────────────────────────

type Grid = Pick<Heightmap, "bounds" | "width" | "height" | "elevations_m" | "min_m">;

// Metres above the heightmap minimum at lon/lat (bilinear; row 0 = north), clamped to the grid edge
export function sampleHeightM(hm: Grid, lon: number, lat: number): number {
  const b: GeoBounds = hm.bounds;
  const fx = Math.min(1, Math.max(0, (lon - b.west) / (b.east - b.west))) * (hm.width - 1);
  const fy = Math.min(1, Math.max(0, (b.north - lat) / (b.north - b.south))) * (hm.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(hm.width - 1, x0 + 1);
  const y1 = Math.min(hm.height - 1, y0 + 1);
  const at = (x: number, y: number) => hm.elevations_m[y * hm.width + x] ?? hm.min_m;
  const tx = fx - x0;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - (fy - y0)) + bottom * (fy - y0) - hm.min_m;
}

// Lowest terrain height under a footprint (its vertices and centroid) so the base never floats
export function footprintBaseM(hm: Grid, ring: ReadonlyArray<readonly [number, number]>): number {
  if (ring.length === 0) return 0;
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return Math.min(sampleHeightM(hm, cx, cy), ...ring.map(([lon, lat]) => sampleHeightM(hm, lon, lat)));
}
