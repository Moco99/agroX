import type {
  ClimateResponse,
  FarmAnalyzeResponse,
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
import {
  isClimateResponse,
  isFarmAnalyzeResponse,
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
async function requestNormalised<T>(path: string, normalise: (v: unknown) => T | null): Promise<T> {
  const res = await fetch(path);
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

export const api = {
  health: () => request<Health>("/api/health", isHealth),
  config: () => request<TwinConfig>("/api/twin/config", isTwinConfig),
  farm: (farmId: string) =>
    request<FarmAnalyzeResponse>("/api/farms/analyze", isFarmAnalyzeResponse, {
      method: "POST",
      body: JSON.stringify({ farm_id: farmId }),
    }),
  simulate: (body: TwinSimulateRequest, signal?: AbortSignal) =>
    request<TwinSimulateResponse>(
      "/api/twin/simulate",
      isTwinSimulateResponse,
      { method: "POST", body: JSON.stringify(body) },
      signal,
    ),
  ndvi: (farmId: string, source: "modis_ndvi" | "sentinel2") =>
    request<ObservationSeries>(
      `/api/observations/ndvi?farm_id=${encodeURIComponent(farmId)}&source=${source}`,
      isObservationSeries,
    ),
  soilMoisture: (farmId: string) =>
    request<ObservationSeries>(
      `/api/observations/soil-moisture?farm_id=${encodeURIComponent(farmId)}`,
      isObservationSeries,
    ),
  overlay: (farmId: string) =>
    request<NdviOverlay>(`/api/observations/ndvi-overlay?farm_id=${encodeURIComponent(farmId)}`, isNdviOverlay),
  climate: (farmId: string, start: string, end: string) =>
    request<ClimateResponse>(`/api/climate?${q({ farm_id: farmId, start, end })}`, isClimateResponse),

  // ── Imagery / terrain / region (built by the data agent; every caller must tolerate a rejection) ──
  imageryMeta: (farmId: string) => requestNormalised<ImageryMeta>(`/api/imagery/meta?${q({ farm_id: farmId })}`, toImageryMeta),
  ndviDates: (farmId: string) => requestNormalised<NdviDates>(`/api/imagery/ndvi/dates?${q({ farm_id: farmId })}`, toNdviDates),
  heightmap: (farmId: string) => requestNormalised<Heightmap>(`/api/terrain/heightmap?${q({ farm_id: farmId })}`, toHeightmap),
  regionSummary: (start: string, end: string) =>
    requestNormalised<RegionSummary>(`/api/region/summary?${q({ period_start: start, period_end: end })}`, toRegionSummary),
  // Image endpoints are consumed as URLs by <img> and THREE.TextureLoader, never parsed here
  basemapUrl: (farmId: string, size = 2048) => `/api/imagery/basemap?${q({ farm_id: farmId, size })}`,
  ndviImageUrl: (farmId: string, date: string, size = 1024) => `/api/imagery/ndvi?${q({ farm_id: farmId, date, size })}`,
};
