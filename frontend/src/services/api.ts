import type {
  ClimateResponse,
  FarmAnalyzeResponse,
  FarmLoadStatus,
  Health,
  Heightmap,
  ImageryMeta,
  NdviDates,
  NdviOverlay,
  ObservationSeries,
  RegionSummary,
  TwinConfig,
  TwinSimulateRequest,
  TwinSimulateResponse,
} from "../types/api";
import type { CropCatalogLite, LatLon } from "../types/parcel";
import {
  isClimateResponse,
  isCropCatalog,
  isFarmAnalyzeResponse,
  isFarmLoadStatus,
  isHealth,
  isNdviOverlay,
  isObservationSeries,
  isRecord,
  isTwinConfig,
  isTwinSimulateResponse,
  toHeightmap,
  toImageryMeta,
  toNdviDates,
  toRegionSummary,
} from "../types/guards";

// ─────────────────────────────────────────
// Section: HTTP client (same-origin /api, proxied by Vite in dev)
// ─────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  guard: (v: unknown) => v is T,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, { ...init, signal, headers: { "Content-Type": "application/json" } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(detail, res.status);
  }
  if (!guard(body)) throw new ApiError(`unexpected payload from ${path}`, 500);
  return body;
}

// Normalising fetch: the data agent's endpoints may differ slightly from the proposal, so the body is
// mapped with a tolerant converter instead of a strict guard, and a null result counts as "not available".
async function requestNormalised<T>(path: string, normalise: (v: unknown) => T | null, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(detail, res.status);
  }
  const out = normalise(body);
  if (out === null) throw new ApiError(`unexpected payload from ${path}`, 500);
  return out;
}

const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

const enc = encodeURIComponent;

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/api/health", isHealth, undefined, signal),
  config: (signal?: AbortSignal) => request<TwinConfig>("/api/twin/config", isTwinConfig, undefined, signal),
  // GET /api/farms/{id} opens (and on first call builds) any pt_<lat>_<lon> parcel as well as the pilot
  farm: (farmId: string, signal?: AbortSignal) =>
    request<FarmAnalyzeResponse>(`/api/farms/${enc(farmId)}`, isFarmAnalyzeResponse, undefined, signal),
  // Registers drawn polygons (one zone each); the returned poly_ id then opens like any pt_ id
  registerPolygonFarm: (polygons: LatLon[][], signal?: AbortSignal) =>
    request<{ farm_id: string; area_ha: number }>(
      "/api/farms/polygon",
      (v): v is { farm_id: string; area_ha: number } =>
        isRecord(v) && typeof v.farm_id === "string" && typeof v.area_ha === "number",
      { method: "POST", body: JSON.stringify({ polygons }) },
      signal,
    ),
  // POST starts the background load (202); GET reports per-source progress
  prepare: (farmId: string, signal?: AbortSignal) =>
    request<FarmLoadStatus>(`/api/farms/${enc(farmId)}/prepare`, isFarmLoadStatus, { method: "POST" }, signal),
  status: (farmId: string, signal?: AbortSignal) =>
    request<FarmLoadStatus>(`/api/farms/${enc(farmId)}/status`, isFarmLoadStatus, undefined, signal),
  simulate: (body: TwinSimulateRequest, signal?: AbortSignal) =>
    request<TwinSimulateResponse>(
      "/api/twin/simulate",
      isTwinSimulateResponse,
      { method: "POST", body: JSON.stringify(body) },
      signal,
    ),
  ndvi: (farmId: string, source: "modis_ndvi" | "sentinel2", signal?: AbortSignal) =>
    request<ObservationSeries>(`/api/observations/ndvi?${q({ farm_id: farmId, source })}`, isObservationSeries, undefined, signal),
  soilMoisture: (farmId: string, signal?: AbortSignal) =>
    request<ObservationSeries>(`/api/observations/soil-moisture?${q({ farm_id: farmId })}`, isObservationSeries, undefined, signal),
  overlay: (farmId: string, signal?: AbortSignal) =>
    request<NdviOverlay>(`/api/observations/ndvi-overlay?${q({ farm_id: farmId })}`, isNdviOverlay, undefined, signal),
  // Pilot: the farm id picks the point; any other parcel passes its own coordinates (the endpoint ignores farm_id)
  climate: (where: { farmId?: string; lat?: number; lon?: number }, start: string, end: string, signal?: AbortSignal) =>
    request<ClimateResponse>(
      `/api/climate?${q({ farm_id: where.farmId, lat: where.lat, lon: where.lon, start, end })}`,
      isClimateResponse,
      undefined,
      signal,
    ),
  crops: (signal?: AbortSignal) => request<CropCatalogLite>("/api/crops", isCropCatalog, undefined, signal),

  // ── Imagery / terrain / region (every caller must tolerate a rejection) ──
  imageryMeta: (farmId: string, signal?: AbortSignal) =>
    requestNormalised<ImageryMeta>(`/api/imagery/meta?${q({ farm_id: farmId })}`, toImageryMeta, signal),
  ndviDates: (farmId: string, signal?: AbortSignal) =>
    requestNormalised<NdviDates>(`/api/imagery/ndvi/dates?${q({ farm_id: farmId })}`, toNdviDates, signal),
  heightmap: (farmId: string, signal?: AbortSignal) =>
    requestNormalised<Heightmap>(`/api/terrain/heightmap?${q({ farm_id: farmId })}`, toHeightmap, signal),
  regionSummary: (start: string, end: string, signal?: AbortSignal) =>
    requestNormalised<RegionSummary>(`/api/region/summary?${q({ period_start: start, period_end: end })}`, toRegionSummary, signal),
  // Image endpoints are consumed as URLs by <img> and THREE.TextureLoader, never parsed here
  basemapUrl: (farmId: string, size = 2048) => `/api/imagery/basemap?${q({ farm_id: farmId, size })}`,
  ndviImageUrl: (farmId: string, date: string, size = 1024) => `/api/imagery/ndvi?${q({ farm_id: farmId, date, size })}`,
};
