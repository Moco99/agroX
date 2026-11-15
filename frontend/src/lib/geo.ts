import type { Farm, PolygonGeometry } from "../types/api";

// ─────────────────────────────────────────
// Section: Local projection (lon/lat -> metres around the farm centroid)
// ─────────────────────────────────────────

// An equirectangular projection is exact enough for a ~1.2 km farm (< 0.1 % distortion) and needs no library
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

export interface Projector {
  toLocal: (lon: number, lat: number) => [number, number];
  extent: { minX: number; maxX: number; minY: number; maxY: number };
}

export function ring(geometry: PolygonGeometry): number[][] {
  return geometry.coordinates[0] ?? [];
}

export function makeProjector(farm: Farm): Projector {
  const lat0 = farm.centroid.lat;
  const lon0 = farm.centroid.lon;
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const toLocal = (lon: number, lat: number): [number, number] => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT];
  const pts = ring(farm.geometry).map(([lon, lat]) => toLocal(lon ?? lon0, lat ?? lat0));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    toLocal,
    extent: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}

export function localRing(geometry: PolygonGeometry, proj: Projector): [number, number][] {
  return ring(geometry).map(([lon, lat]) => proj.toLocal(lon ?? 0, lat ?? 0));
}

// Ray casting point-in-polygon on the projected ring
export function insidePolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const pi = poly[i];
    const pj = poly[j];
    if (!pi || !pj) continue;
    const intersects = pi[1] > y !== pj[1] > y && x < ((pj[0] - pi[0]) * (y - pi[1])) / (pj[1] - pi[1] + 1e-12) + pi[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

// Deterministic PRNG (mulberry32) so the decorative scene is identical between reloads
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
