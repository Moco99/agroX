import { es } from "../i18n/es";
import type { ClimateResponse, DataState, FarmAnalyzeResponse, ObservationSeries } from "../types/api";

// ─────────────────────────────────────────
// Section: Labels derived from what a parcel actually loaded (sources, crop, NDVI, 3D fallbacks)
// ─────────────────────────────────────────

// "Copernicus DEM GLO-30 (Planetary Computer)" -> "Copernicus DEM GLO-30"; keeps the banner short
function shortSource(s: string): string {
  return s.split(/ \(| - |, /)[0]?.trim() ?? s;
}

// Sources really used by a point/drawn parcel, read from the farm, climate and NDVI provenance (deduplicated)
export function parcelSources(
  farm: FarmAnalyzeResponse | null,
  climate: ClimateResponse | null,
  sentinel2: ObservationSeries | null,
): string[] {
  const list: string[] = [];
  const add = (s: string | null | undefined) => s && list.push(shortSource(s));
  add(climate?.series.provenance.source ?? "NASA POWER");
  add(farm?.farm.provenance.terrain?.source);
  add(farm?.farm.provenance.soil?.source);
  if (farm?.latest_ndvi_source || (sentinel2?.points.length ?? 0) > 0) add(farm?.latest_ndvi_source ?? sentinel2?.provenance.source);
  list.push("Esri World Imagery");
  return [...new Set(list)];
}

export function stageStatusOf(farm: FarmAnalyzeResponse | null, stage: string): string | null {
  return farm?.load_status?.stages.find((s) => s.stage === stage)?.status ?? null;
}

// Text for an NDVI value that is not there yet: still downloading vs. truly no scenes
export function ndviMissingText(status: string | null): string {
  return status === "running" || status === "pending" ? es.ndviDownloading : es.ndviNoScenes;
}

// A zone whose crop was never declared still simulates the default crop: say so, flagged ESTIMATED
export function cropLabel(cropId: string, declared: boolean): { text: string; state: DataState } {
  const name = es.crops[cropId] ?? cropId;
  return declared ? { text: name, state: "DECLARED" } : { text: es.assumedCrop(name), state: "ESTIMATED" };
}

export type ImageryState = "loading" | "ready" | "failed" | null;

// The 3D fallback note only appears when the tint or flat terrain is actually in use
export function fallbackNote(imagery: ImageryState, hasHeightmap: boolean, contextLoaded: boolean): string | null {
  const noImagery = imagery === "failed";
  const noRelief = contextLoaded && !hasHeightmap;
  if (noImagery && noRelief) return es.openParcel.twinNoImagery;
  if (noImagery) return es.openParcel.twinNoImageryOnly;
  return noRelief ? es.openParcel.twinNoRelief : null;
}
