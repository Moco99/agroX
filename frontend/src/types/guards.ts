import type {
  DataState,
  FarmAnalyzeResponse,
  Health,
  NdviOverlay,
  ObservationSeries,
  TwinConfig,
  TwinSimulateResponse,
} from "./api";

// ─────────────────────────────────────────
// Section: Runtime guards for API payloads
// ─────────────────────────────────────────

// Responses arrive as `unknown`; these guards check the fields the UI relies on before narrowing the type,
// so a contract drift fails loudly at the boundary instead of deep inside a component.

const DATA_STATES: readonly DataState[] = ["MEASURED", "DECLARED", "ESTIMATED", "SIMULATED", "SYNTHETIC"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDataState(value: unknown): value is DataState {
  return typeof value === "string" && (DATA_STATES as readonly string[]).includes(value);
}

function hasArray(obj: Record<string, unknown>, key: string): boolean {
  return Array.isArray(obj[key]);
}

export function isHealth(value: unknown): value is Health {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    (value.data_mode === "real" || value.data_mode === "synthetic") &&
    isDataState(value.data_state)
  );
}

export function isFarmAnalyzeResponse(value: unknown): value is FarmAnalyzeResponse {
  if (!isRecord(value) || !isRecord(value.farm)) return false;
  const farm = value.farm;
  return hasArray(farm, "zones") && isRecord(value.latest_ndvi) && typeof value.catalog_version === "string";
}

export function isTwinSimulateResponse(value: unknown): value is TwinSimulateResponse {
  if (!isRecord(value) || !hasArray(value, "zones") || !isRecord(value.farm_summary)) return false;
  const zones = value.zones as unknown[];
  return zones.every(
    (z) => isRecord(z) && hasArray(z, "states") && isRecord(z.summary) && isDataState(z.data_state),
  );
}

export function isObservationSeries(value: unknown): value is ObservationSeries {
  return isRecord(value) && hasArray(value, "points") && isRecord(value.provenance) && typeof value.source_id === "string";
}

export function isNdviOverlay(value: unknown): value is NdviOverlay {
  return isRecord(value) && typeof value.png_base64 === "string" && isRecord(value.bounds);
}

export function isTwinConfig(value: unknown): value is TwinConfig {
  return isRecord(value) && isRecord(value.irrigation_levels) && isRecord(value.presets);
}
