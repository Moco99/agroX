import type { PhenoStage } from "../types/api";
import { insidePolygon, seededRandom } from "./geo";

// ─────────────────────────────────────────
// Section: Crop growth forms (visual archetypes, not botanical models)
// ─────────────────────────────────────────

// Each crop_id is drawn with one procedural archetype; proportions are chosen for legibility at diorama scale
export type GrowthForm = "tall_grass" | "bush" | "small_grain" | "sunflower" | "cover";

const FORM_BY_CROP: Record<string, GrowthForm> = {
  corn: "tall_grass",
  maize: "tall_grass",
  sorghum: "tall_grass",
  soybean: "bush",
  soy: "bush",
  bean: "bush",
  chickpea: "bush",
  wheat: "small_grain",
  cereal_rye: "small_grain",
  rye: "small_grain",
  oat: "small_grain",
  barley: "small_grain",
  rice: "small_grain",
  sunflower: "sunflower",
  cover_vetch: "cover",
  clover: "cover",
};

export function growthFormFor(cropId: string): GrowthForm {
  const known = FORM_BY_CROP[cropId];
  if (known) return known;
  // Unknown cover crops still read as a low mat; any other unknown crop falls back to a generic bush
  return cropId.startsWith("cover") ? "cover" : "bush";
}

// ─────────────────────────────────────────
// Section: Stage → visual parameters (illustrative metaphor of the backend stage, not a growth model)
// ─────────────────────────────────────────

export interface StageVisual {
  // false = bare furrowed soil (before planting)
  visible: boolean;
  // 0..1 vertical scale applied to the plant archetype
  growth: number;
  // 0..1 how much of the reproductive organs (tassel, pods, heads, flowers) is drawn
  reproductive: number;
  // 0 = green canopy, 1 = fully senescent / straw coloured
  senescence: number;
  stubble: boolean;
}

// Plants never shrink below this so a just-emerged field still shows which crop it is
const MIN_VISIBLE_GROWTH = 0.12;
const STUBBLE_GROWTH = 0.14;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

// `canopy` is the backend expected_canopy value (0..1) for the date; `stage` the twin stage of that day
export function stageVisual(stage: PhenoStage | null | undefined, canopy: number): StageVisual {
  const c = clamp01(canopy);
  const grown = Math.max(MIN_VISIBLE_GROWTH, c);
  switch (stage) {
    case "PRE_PLANTING":
      return { visible: false, growth: 0, reproductive: 0, senescence: 0, stubble: false };
    case "INITIAL":
      return { visible: true, growth: grown, reproductive: 0, senescence: 0, stubble: false };
    case "DEVELOPMENT":
      return { visible: true, growth: grown, reproductive: 0, senescence: 0, stubble: false };
    case "MID_SEASON":
      return { visible: true, growth: grown, reproductive: 1, senescence: 0, stubble: false };
    case "LATE_SEASON":
      // Late season keeps full height: the canopy curve drops, but standing plants dry out rather than shrink
      return { visible: true, growth: Math.max(grown, 0.85), reproductive: 1, senescence: 0.75, stubble: false };
    case "HARVESTED":
      return { visible: true, growth: STUBBLE_GROWTH, reproductive: 0, senescence: 1, stubble: true };
    default:
      // No stage (no simulation for the day): show the canopy curve alone
      return { visible: c > 0, growth: grown, reproductive: c > 0.8 ? 1 : 0, senescence: 0, stubble: false };
  }
}

// ─────────────────────────────────────────
// Section: Row layout (deterministic, seeded; spacing is a drawing density, not agronomic spacing)
// ─────────────────────────────────────────

export interface RowLayoutOptions {
  // Distance between drawn rows and between plants on a row, in local metres
  rowSpacingM: number;
  plantSpacingM: number;
  maxPlants: number;
  seed: number;
}

export interface PlantSpot {
  x: number;
  y: number;
  // Per-plant size and heading jitter so instanced rows do not look stamped
  scale: number;
  heading: number;
}

// Rows follow the longer side of the zone's bounding box, as planters usually run the long way
export function rowLayout(ring: [number, number][], opts: RowLayoutOptions): PlantSpot[] {
  if (ring.length < 3 || opts.rowSpacingM <= 0 || opts.plantSpacingM <= 0) return [];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rowsAlongY = maxY - minY >= maxX - minX;
  let rowSpacing = opts.rowSpacingM;
  let plantSpacing = opts.plantSpacingM;
  // Thin the grid uniformly when it would exceed the cap, instead of cropping part of the zone
  const estimate = ((maxX - minX) / rowSpacing) * ((maxY - minY) / plantSpacing);
  if (estimate > opts.maxPlants) {
    const k = Math.sqrt(estimate / opts.maxPlants);
    rowSpacing *= k;
    plantSpacing *= k;
  }
  const rand = seededRandom(opts.seed);
  const out: PlantSpot[] = [];
  const [aMin, aMax, bMin, bMax] = rowsAlongY ? [minX, maxX, minY, maxY] : [minY, maxY, minX, maxX];
  for (let a = aMin + rowSpacing / 2; a < aMax; a += rowSpacing) {
    for (let b = bMin + plantSpacing / 2; b < bMax; b += plantSpacing) {
      // Jitter only along the row so the furrow lines stay readable
      const along = b + (rand() - 0.5) * plantSpacing * 0.6;
      const across = a + (rand() - 0.5) * rowSpacing * 0.12;
      const x = rowsAlongY ? across : along;
      const y = rowsAlongY ? along : across;
      const scale = 0.82 + rand() * 0.36;
      const heading = rand() * Math.PI * 2;
      if (insidePolygon(x, y, ring) && out.length < opts.maxPlants) out.push({ x, y, scale, heading });
    }
  }
  return out;
}

export function rowsRunAlongY(ring: [number, number][]): boolean {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys) >= Math.max(...xs) - Math.min(...xs);
}

// ─────────────────────────────────────────
// Section: Soil moisture metaphor (darker = wetter; colour only, no threshold or class implied)
// ─────────────────────────────────────────

const DRY_SOIL: [number, number, number] = [0xb5, 0x96, 0x68];
const WET_SOIL: [number, number, number] = [0x3f, 0x2c, 0x1f];
const UNKNOWN_SOIL: [number, number, number] = [0x7a, 0x62, 0x47];

// `fraction` is TwinState.soil_water_fraction (0 = depleted, 1 = full); null when no state for the day
export function soilTone(fraction: number | null | undefined): { hex: string; roughness: number } {
  const rgb =
    fraction === null || fraction === undefined || !Number.isFinite(fraction)
      ? UNKNOWN_SOIL
      : DRY_SOIL.map((d, i) => Math.round(d + ((WET_SOIL[i] ?? d) - d) * clamp01(fraction))) as [number, number, number];
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  // Wet soil reads glossier; purely a rendering cue
  const roughness = fraction === null || fraction === undefined ? 0.92 : 0.96 - 0.3 * clamp01(fraction);
  return { hex, roughness };
}
