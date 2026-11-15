import type { Declaration } from "./parcel";
import { latestUsablePlanting, seasonWindow, suggestPlantingDate } from "./parcel";
import type { CropCatalogLite } from "../types/parcel";

// ─────────────────────────────────────────
// Section: Simulation plan of a parcel (crops, planting dates and season window)
// ─────────────────────────────────────────

export interface PlanZone {
  zone_id: string;
  crop_id: string;
}

export interface RunPlan {
  span: { start: string; end: string };
  // crop_id -> ISO date actually sent (declared or hemisphere suggestion)
  plantingDates: Record<string, string>;
  // Subset of plantingDates that the user typed in; the rest are ESTIMATED suggestions
  declaredPlanting: string[];
  // zone_id -> crop_id the simulation will use
  zoneCrops: Record<string, string>;
  // zone_id -> crop_id only where the user's choice differs from the farm's crop (what the request carries)
  cropOverrides: Record<string, string>;
}

// Used when the catalog does not know a crop: a window that ends at the weather coverage still produces a run
const FALLBACK_SPAN_DAYS = 210;

// Flip to true when the backend accepts start/end in different years (tracked in the backend progress file)
const CROSS_YEAR_SEASONS = true;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildRunPlan(args: {
  zones: PlanZone[];
  lat: number;
  declaration: Declaration;
  catalog: CropCatalogLite | null;
  coverageEnd: string;
  // Backend calendar suggestion (declared_inputs); wins over the client estimate but never over the user
  suggestedSeason?: { start: string; end: string } | null;
  suggestedPlanting?: Record<string, string> | null;
}): RunPlan {
  const { zones, lat, declaration, catalog, coverageEnd, suggestedSeason, suggestedPlanting } = args;
  const zoneCrops: Record<string, string> = {};
  const cropOverrides: Record<string, string> = {};
  for (const z of zones) {
    const chosen = declaration.crops[z.zone_id] ?? z.crop_id;
    zoneCrops[z.zone_id] = chosen;
    if (chosen !== z.crop_id) cropOverrides[z.zone_id] = chosen;
  }

  const plantingDates: Record<string, string> = {};
  const declaredPlanting: string[] = [];
  let start: string | null = null;
  let end: string | null = null;
  for (const cropId of new Set(Object.values(zoneCrops))) {
    const params = catalog?.crops.find((c) => c.crop_id === cropId);
    if (!params) continue;
    const declared = declaration.planting[cropId];
    const zoneOfCrop = zones.find((z) => zoneCrops[z.zone_id] === cropId)?.zone_id;
    const fromBackend = suggestedPlanting?.[cropId] ?? (zoneOfCrop ? suggestedPlanting?.[zoneOfCrop] : undefined);
    const planting =
      declared ??
      fromBackend ??
      latestUsablePlanting((y) => suggestPlantingDate(params, lat, y), params.cycle_days, coverageEnd);
    if (declared) declaredPlanting.push(cropId);
    plantingDates[cropId] = planting;
    const w = seasonWindow(planting, params.cycle_days, coverageEnd);
    if (start === null || w.start < start) start = w.start;
    if (end === null || w.end > end) end = w.end;
  }
  const anyDeclared = declaredPlanting.length > 0;
  // With nothing declared the backend's own suggested season is the window (it knows the hemisphere's calendar)
  let span =
    !anyDeclared && suggestedSeason
      ? suggestedSeason
      : start !== null && end !== null && start < end
      ? { start, end }
      : { start: shiftDays(coverageEnd, -FALLBACK_SPAN_DAYS), end: coverageEnd };
  // The simulator runs one calendar year per request, so a southern season that crosses New Year is cut at Dec 31
  if (!CROSS_YEAR_SEASONS) {
    const yearEnd = `${span.start.slice(0, 4)}-12-31`;
    if (span.end > yearEnd) span = { start: span.start, end: yearEnd };
  }
  return { span, plantingDates, declaredPlanting, zoneCrops, cropOverrides };
}
