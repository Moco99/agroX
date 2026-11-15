import type { GeoBounds } from "../types/api";

// ─────────────────────────────────────────
// Section: OpenStreetMap building footprints (Overpass, no key). Illustrative 3D only, never a measurement.
// ─────────────────────────────────────────

export interface Building {
  // [lon, lat] vertices, not closed
  ring: [number, number][];
  height_m: number;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TIMEOUT_MS = 8000;
const DEFAULT_HEIGHT_M = 6;
const LEVEL_M = 3;
const MAX_BUILDINGS = 400;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Height from `height`, else `building:levels` x 3 m, else a default; clamped so one bad tag cannot spike the scene
export function buildingHeight(tags: Record<string, unknown>): number {
  const h = num(tags.height) ?? (num(tags["building:levels"]) ?? 0) * LEVEL_M;
  return Math.min(h > 0 ? h : DEFAULT_HEIGHT_M, 120);
}

// Tolerant parser for an Overpass `out geom` payload: anything malformed is skipped, never thrown
export function parseOverpassBuildings(body: unknown): Building[] {
  const elements = (body as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Building[] = [];
  for (const el of elements) {
    if (out.length >= MAX_BUILDINGS) break;
    if (!el || typeof el !== "object") continue;
    const { geometry, tags } = el as { geometry?: unknown; tags?: Record<string, unknown> };
    if (!tags || !Array.isArray(geometry)) continue;
    const ring: [number, number][] = [];
    for (const p of geometry) {
      const { lon, lat } = (p ?? {}) as { lon?: unknown; lat?: unknown };
      if (typeof lon === "number" && typeof lat === "number") ring.push([lon, lat]);
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    if (ring.length >= 3) out.push({ ring, height_m: buildingHeight(tags) });
  }
  return out;
}

export const overpassQuery = (b: GeoBounds) =>
  `[out:json][timeout:8];way["building"](${b.south},${b.west},${b.north},${b.east});out geom ${MAX_BUILDINGS};`;

const cache = new Map<string, Promise<Building[]>>();

// Never rejects: a timeout, an HTTP error or a bad payload all mean "no buildings"
export function fetchBuildings(b: GeoBounds, signal?: AbortSignal): Promise<Building[]> {
  const key = [b.west, b.south, b.east, b.north].map((v) => v.toFixed(4)).join(",");
  const hit = cache.get(key);
  if (hit) return hit;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const p = fetch(`${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(b))}`, { signal: ctl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseOverpassBuildings)
    .catch(() => {
      // A failure must not be cached: the next view may succeed
      cache.delete(key);
      return [] as Building[];
    })
    .finally(() => clearTimeout(timer));
  cache.set(key, p);
  return p;
}
