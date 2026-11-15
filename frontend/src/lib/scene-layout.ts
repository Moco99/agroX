// ─────────────────────────────────────────
// Section: Scene layout helpers (pure; scene units, x east / z south)
// ─────────────────────────────────────────

export interface Extent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Local metres (x east, y north) → scene box, given the scene scale
export function ringExtent(ring: [number, number][], scale: number): Extent {
  const xs = ring.map((p) => p[0] * scale);
  // `0 -` instead of unary minus so a zero row gives +0, not -0 (which breaks equality checks)
  const zs = ring.map((p) => 0 - p[1] * scale);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

// ─────────────────────────────────────────
// Section: Camera fit
// ─────────────────────────────────────────

// OrbitControls limits; the fit must land inside them or the first wheel gesture jumps
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 160;
// Fraction of the shorter viewport side the farm diagonal should occupy on first paint
const FIT_FRACTION = 0.68;

// Orthographic zoom that frames the farm whatever its size: a 600 m point parcel and the 1.2 km
// pilot must both fill the canvas instead of sharing one zoom tuned for the pilot
export function fittedZoom(extent: Extent, width: number, height: number): number {
  const diagonal = Math.hypot(extent.maxX - extent.minX, extent.maxZ - extent.minZ);
  if (!(diagonal > 0) || !(width > 0) || !(height > 0)) return MIN_ZOOM;
  const zoom = (Math.min(width, height) * FIT_FRACTION) / diagonal;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// ─────────────────────────────────────────
// Section: Farmstead placement (decorative group kept clear of observed buildings)
// ─────────────────────────────────────────

// Half-size of the farmstead yard; the group (barn, silo, bins, house) fits inside this square
export const FARMSTEAD_HALF = 0.9;
// Yard centre sits this far south of the group origin (see Farmstead in props.tsx)
const YARD_OFFSET_Z = 0.2;
// Gap kept between the yard and any observed footprint or the slab edge
const CLEARANCE = 0.1;

// Box the farmstead occupies when its group origin is at (cx, cz)
export function farmsteadBox(cx: number, cz: number): Extent {
  return { minX: cx - FARMSTEAD_HALF, maxX: cx + FARMSTEAD_HALF, minZ: cz + YARD_OFFSET_Z - FARMSTEAD_HALF, maxZ: cz + YARD_OFFSET_Z + FARMSTEAD_HALF };
}

// Candidate origins clockwise from the north-east corner: outside the fields, east of the road
// (which runs at maxX + 0.9), inside a 300 m slab margin and away from the windbreak on the west and south edges
export function farmsteadCandidates(extent: Extent): [number, number][] {
  return [
    [extent.maxX + 2.0, extent.minZ + 1.0],
    [extent.maxX + 2.0, extent.maxZ - 1.2],
    [extent.minX + 1.2, extent.minZ - 2.0],
    [extent.maxX - 1.4, extent.minZ - 2.0],
  ];
}

function overlaps(a: Extent, b: Extent, gap: number): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}

function inside(box: Extent, slab: Extent, gap: number): boolean {
  return box.minX >= slab.minX + gap && box.maxX <= slab.maxX - gap && box.minZ >= slab.minZ + gap && box.maxZ <= slab.maxZ - gap;
}

// First candidate whose yard lies on the slab and overlaps no observed footprint. `footprints` is
// null while the building request is pending or when it failed: a failed download is not evidence of
// an empty field, so the farmstead is withheld rather than risk standing on a real house.
export function pickFarmsteadSite(extent: Extent, slab: Extent, footprints: Extent[] | null): [number, number] | null {
  if (!footprints) return null;
  for (const [cx, cz] of farmsteadCandidates(extent)) {
    const box = farmsteadBox(cx, cz);
    if (!inside(box, slab, CLEARANCE)) continue;
    if (footprints.some((f) => overlaps(box, f, CLEARANCE))) continue;
    return [cx, cz];
  }
  return null;
}
