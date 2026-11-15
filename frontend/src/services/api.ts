import type {
  FarmAnalyzeResponse,
  Health,
  NdviOverlay,
  ObservationSeries,
  TwinConfig,
  TwinSimulateRequest,
  TwinSimulateResponse,
} from "../types/api";
import {
  isFarmAnalyzeResponse,
  isHealth,
  isNdviOverlay,
  isObservationSeries,
  isRecord,
  isTwinConfig,
  isTwinSimulateResponse,
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
};
