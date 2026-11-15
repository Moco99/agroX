import type {
  AptitudeEntry,
  BasemapInfo,
  ClimateResponse,
  DataState,
  FarmAnalyzeResponse,
  GeoBounds,
  Health,
  Heightmap,
  ImageryMeta,
  NdviDates,
  NdviOverlay,
  ObservationSeries,
  RegionMetric,
  RegionSummary,
  TwinConfig,
  TwinSimulateResponse,
} from "./api";
import type { CropCatalogLite } from "./parcel";

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
    (value.data_mode === "real" || value.data_mode === "synthetic" || value.data_mode === "live") &&
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

// ─────────────────────────────────────────
// Section: Tolerant normalisers for the imagery / terrain / region endpoints
// ─────────────────────────────────────────

// These endpoints are being built in parallel by the data agent, so instead of strict guards we accept
// the documented shape plus the most likely aliases and return null when nothing usable arrives.

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function stateOf(v: unknown, fallback: DataState): DataState {
  return isDataState(v) ? v : fallback;
}

export function toBounds(v: unknown): GeoBounds | null {
  if (Array.isArray(v) && v.length === 4) {
    const [w, s, e, n] = v.map(num);
    return typeof w === "number" && typeof s === "number" && typeof e === "number" && typeof n === "number"
      ? { west: w, south: s, east: e, north: n }
      : null;
  }
  if (!isRecord(v)) return null;
  const west = num(v.west ?? v.min_lon ?? v.minx);
  const south = num(v.south ?? v.min_lat ?? v.miny);
  const east = num(v.east ?? v.max_lon ?? v.maxx);
  const north = num(v.north ?? v.max_lat ?? v.maxy);
  return west !== null && south !== null && east !== null && north !== null ? { west, south, east, north } : null;
}

export function toImageryMeta(v: unknown): ImageryMeta | null {
  if (!isRecord(v)) return null;
  const bounds = toBounds(v.bounds ?? v.bbox ?? v.bounds_wgs84);
  if (!bounds) return null;
  let basemap: BasemapInfo | null = null;
  if (isRecord(v.basemap)) {
    const b = v.basemap;
    basemap = {
      available: b.available !== false,
      source: str(b.source),
      resolution_m: num(b.resolution_m),
      date: str(b.date),
      data_state: stateOf(b.data_state, "MEASURED"),
    };
  } else if (typeof v.basemap === "string" || v.basemap === true) {
    basemap = { available: true, source: str(v.basemap), resolution_m: null, date: null, data_state: "MEASURED" };
  }
  return {
    farm_id: str(v.farm_id) ?? "",
    bounds,
    crs: str(v.crs) ?? "EPSG:4326",
    basemap,
    ndvi_dates: strArray(v.ndvi_dates ?? v.dates),
    ndvi_source: str(v.ndvi_source),
    warnings: strArray(v.warnings),
  };
}

export function toNdviDates(v: unknown): NdviDates | null {
  if (Array.isArray(v)) return { farm_id: "", source: null, dates: strArray(v), warnings: [] };
  if (!isRecord(v)) return null;
  const raw = v.dates ?? v.ndvi_dates ?? v.items;
  // Some shapes list objects {date, cloud_cover}: keep only the date
  const dates = Array.isArray(raw)
    ? raw.map((d) => (isRecord(d) ? str(d.date) : str(d))).filter((d): d is string => d !== null)
    : [];
  return { farm_id: str(v.farm_id) ?? "", source: str(v.source), dates, warnings: strArray(v.warnings) };
}

export function toHeightmap(v: unknown): Heightmap | null {
  if (!isRecord(v)) return null;
  const bounds = toBounds(v.bounds ?? v.bbox ?? v.bounds_wgs84);
  const width = num(v.width ?? v.cols);
  const height = num(v.height ?? v.rows);
  const raw = v.elevations_m ?? v.values ?? v.data ?? v.heights;
  if (!bounds || width === null || height === null || !Array.isArray(raw)) return null;
  // Accept a flat array or a list of rows
  const flat: number[] = [];
  for (const row of raw) {
    if (Array.isArray(row)) for (const x of row) flat.push(num(x) ?? Number.NaN);
    else flat.push(num(row) ?? Number.NaN);
  }
  if (flat.length !== width * height) return null;
  const valid = flat.filter((x) => Number.isFinite(x));
  if (valid.length === 0) return null;
  const minV = Math.min(...valid);
  const maxV = Math.max(...valid);
  return {
    farm_id: str(v.farm_id) ?? "",
    bounds,
    width,
    height,
    elevations_m: flat.map((x) => (Number.isFinite(x) ? x : minV)),
    min_m: num(v.min_m) ?? minV,
    max_m: num(v.max_m) ?? maxV,
    resolution_m: num(v.resolution_m),
    source: str(v.source),
    data_state: stateOf(v.data_state, "MEASURED"),
    warnings: strArray(v.warnings),
  };
}

function toRegionMetric(v: unknown, unit: string): RegionMetric | null {
  if (num(v) !== null) {
    return { value: num(v), unit, delta: null, delta_pct: null, reference: "", data_state: "ESTIMATED", source: null };
  }
  if (!isRecord(v)) return null;
  return {
    value: num(v.value ?? v.mean),
    unit: str(v.unit) ?? unit,
    delta: num(v.delta ?? v.delta_abs),
    delta_pct: num(v.delta_pct),
    reference: str(v.reference ?? v.vs) ?? "",
    data_state: stateOf(v.data_state, "ESTIMATED"),
    source: str(v.source),
  };
}

export function toRegionSummary(v: unknown): RegionSummary | null {
  if (!isRecord(v)) return null;
  const ndvi = toRegionMetric(v.ndvi ?? v.ndvi_mean, "");
  const precipitation = toRegionMetric(v.precipitation ?? v.precip_total, "mm");
  const temperature = toRegionMetric(v.temperature ?? v.t_mean, "°C");
  const radiation = toRegionMetric(v.radiation ?? v.solar_rad, "MJ/m²");
  if (!ndvi || !precipitation || !temperature || !radiation) return null;
  const series = Array.isArray(v.ndvi_series) ? v.ndvi_series : [];
  const ndvi_series = series
    .map((p) => (isRecord(p) ? { date: str(p.date) ?? "", value: num(p.value) ?? Number.NaN } : null))
    .filter((p): p is { date: string; value: number } => p !== null && p.date !== "" && Number.isFinite(p.value));
  const aptRaw = Array.isArray(v.aptitude) ? v.aptitude : Array.isArray(v.suitability) ? v.suitability : null;
  const aptitude = aptRaw
    ? aptRaw
        .map((a): AptitudeEntry | null =>
          isRecord(a)
            ? {
                crop_id: str(a.crop_id ?? a.crop) ?? "",
                index: num(a.index ?? a.si ?? a.value),
                suitability_class: str(a.suitability_class ?? a.class),
                data_state: stateOf(a.data_state, "MEASURED"),
              }
            : null,
        )
        .filter((a): a is AptitudeEntry => a !== null && a.crop_id !== "")
    : null;
  return {
    region_name: str(v.region_name ?? v.region ?? v.name) ?? "",
    period_start: str(v.period_start ?? (isRecord(v.period) ? v.period.start : null)) ?? "",
    period_end: str(v.period_end ?? (isRecord(v.period) ? v.period.end : null)) ?? "",
    previous_start: str(v.previous_start),
    previous_end: str(v.previous_end),
    ndvi,
    precipitation,
    temperature,
    radiation,
    ndvi_series,
    aptitude,
    aptitude_source: str(v.aptitude_source),
    warnings: strArray(v.warnings),
    origin: "api",
  };
}

export function isClimateResponse(value: unknown): value is ClimateResponse {
  return isRecord(value) && isRecord(value.series) && Array.isArray(value.series.days) && isRecord(value.indicators);
}

// ─────────────────────────────────────────
// Section: Crop catalog (declaration form)
// ─────────────────────────────────────────

export function isCropCatalog(value: unknown): value is CropCatalogLite {
  if (!isRecord(value) || !hasArray(value, "crops") || typeof value.catalog_version !== "string") return false;
  return (value.crops as unknown[]).every(
    (c) =>
      isRecord(c) &&
      typeof c.crop_id === "string" &&
      typeof c.name_es === "string" &&
      typeof c.cycle_days === "number" &&
      isRecord(c.planting_window) &&
      typeof c.planting_window.start_mmdd === "string",
  );
}
