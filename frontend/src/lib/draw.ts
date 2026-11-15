import type { LatLon } from "../types/parcel";

// ─────────────────────────────────────────
// Section: Drawn parcels (pure state transitions; the map and the store only call these)
// ─────────────────────────────────────────

// Mirrors the backend limits (app/providers/live/parcel.py); the backend re-validates everything
export const MAX_POLYGONS = 12;
export const MAX_VERTICES = 100;

export interface DrawState {
  // Finished polygons (open rings, >= 3 vertices each): one zone per polygon
  polygons: LatLon[][];
  // Polygon being drawn
  current: LatLon[];
}

export const EMPTY_DRAW: DrawState = { polygons: [], current: [] };

type Pt = [number, number];

function cross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

// True when no two non-adjacent edges of the closed polygon cross (same rule as the backend)
export function isSimplePolygon(pts: LatLon[]): boolean {
  const ring: Pt[] = [...pts, pts[0]].filter((p): p is LatLon => p !== undefined).map((p) => [p.lon, p.lat]);
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (cross(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
    }
  }
  return true;
}

// Approximate area (ha): shoelace on a local equirectangular projection, as in the backend
export function areaHa(pts: LatLon[]): number {
  if (pts.length < 3) return 0;
  const lat0 = (pts.reduce((s, p) => s + p.lat, 0) / pts.length) * (Math.PI / 180);
  const xy = pts.map((p) => [p.lon * 111320 * Math.cos(lat0), p.lat * 111320] as const);
  let twice = 0;
  for (let i = 0; i < xy.length; i += 1) {
    const a = xy[i]!;
    const b = xy[(i + 1) % xy.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2 / 10000;
}

export function canFinish(s: DrawState): boolean {
  return s.current.length >= 3 && isSimplePolygon(s.current) && s.polygons.length < MAX_POLYGONS;
}

export function finishPolygon(s: DrawState): DrawState {
  return canFinish(s) ? { polygons: [...s.polygons, s.current], current: [] } : s;
}

// A click near the first vertex closes the polygon instead of adding a vertex
export function addVertex(s: DrawState, p: LatLon, nearFirst = false): DrawState {
  if (nearFirst && s.current.length >= 3) return finishPolygon(s);
  if (s.current.length >= MAX_VERTICES || s.polygons.length >= MAX_POLYGONS) return s;
  return { ...s, current: [...s.current, p] };
}

// Undo removes the last vertex; with nothing in progress it reopens the last finished polygon
export function undo(s: DrawState): DrawState {
  if (s.current.length > 0) return { ...s, current: s.current.slice(0, -1) };
  const last = s.polygons.at(-1);
  return last ? { polygons: s.polygons.slice(0, -1), current: last.slice(0, -1) } : s;
}

export function canConfirm(s: DrawState): boolean {
  return s.polygons.length > 0 && s.current.length === 0;
}

// GeoJSON for the map: finished polygons, the open path in progress and its vertices
export function drawFeatures(s: DrawState) {
  const ll = (p: LatLon): Pt => [p.lon, p.lat];
  return {
    type: "FeatureCollection" as const,
    features: [
      ...s.polygons.map((poly) => ({
        type: "Feature" as const,
        properties: { kind: "polygon" },
        geometry: { type: "Polygon" as const, coordinates: [[...poly, poly[0]!].map(ll)] },
      })),
      ...(s.current.length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: { kind: "path" },
              geometry: { type: "LineString" as const, coordinates: s.current.map(ll) },
            },
          ]
        : []),
      ...s.current.map((p, i) => ({
        type: "Feature" as const,
        properties: { kind: i === 0 ? "first" : "vertex" },
        geometry: { type: "Point" as const, coordinates: ll(p) },
      })),
    ],
  };
}
