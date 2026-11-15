// ─────────────────────────────────────────
// Section: Contract types (mirror of backend/app/schemas, hand-written)
// ─────────────────────────────────────────

export type DataState = "MEASURED" | "DECLARED" | "ESTIMATED" | "SIMULATED" | "SYNTHETIC";
export type TwinLevel = "DIGITAL_MODEL" | "DIGITAL_SHADOW" | "DIGITAL_TWIN";
export type PhenoStage = "PRE_PLANTING" | "INITIAL" | "DEVELOPMENT" | "MID_SEASON" | "LATE_SEASON" | "HARVESTED";
export type IrrigationLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type StressClass = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type DataMode = "real" | "synthetic" | "live";

export interface Provenance {
  source: string;
  data_state: DataState;
  retrieved_at?: string | null;
  version?: string | null;
  resolution?: string | null;
  method?: string | null;
}

export interface Location {
  lat: number;
  lon: number;
}

export interface Health {
  status: string;
  version: string;
  data_mode: DataMode;
  data_state: DataState;
  requested_mode: string;
  weather_coverage: { start: string; end: string };
  derived_built_at: string | null;
  farms: string[];
  warnings: string[];
  // Added by the any-parcel backend; absent on older servers, in which case live mode implies support
  any_parcel_supported?: boolean;
}

export interface PolygonGeometry {
  type: string;
  coordinates: number[][][];
}

export interface SoilProfile {
  awc_mm_per_m: number;
  root_depth_max_m: number;
  texture: string | null;
  drainage_class: string | null;
  hydrologic_group: string | null;
  map_unit_name: string | null;
  component_name: string | null;
  provenance: Provenance;
  verified: boolean;
  warnings: string[];
}

export interface TerrainInfo {
  elevation_mean_m: number | null;
  slope_mean_pct: number | null;
  slope_max_pct: number | null;
  erosion_index: string;
  data_state: DataState;
  warnings: string[];
}

export interface CdlYear {
  year: number;
  cdl_code: number;
  crop_id: string;
  purity: number;
}

export interface FarmZone {
  zone_id: string;
  name: string;
  crop_id: string;
  crop_purity: number | null;
  area_ha: number;
  geometry: PolygonGeometry;
  centroid: Location;
  soil: SoilProfile;
  terrain: TerrainInfo;
  cdl_history: CdlYear[];
  irrigation_level: IrrigationLevel;
  data_state: DataState;
}

export interface Farm {
  farm_id: string;
  name: string;
  area_ha: number;
  centroid: Location;
  geometry: PolygonGeometry;
  zones: FarmZone[];
  provenance: Record<string, Provenance>;
  warnings: string[];
}

// Optional blocks added by the any-parcel backend: all tolerated when absent (older servers, the pilot)
export interface DeclaredInputs {
  hemisphere: "north" | "south";
  tropical: boolean;
  suggested_season: { start: string; end: string };
  // Keyed by crop_id (or zone_id); always a calendar suggestion, never an observation
  suggested_planting_dates: Record<string, string>;
  suggestion_state: DataState;
  note: string;
  unsupported_crop_note: string;
}

export interface LandCover {
  status: "ready" | "pending" | "failed" | "not_applicable";
  is_cropland: boolean | null;
  worldcover_2021: string | null;
  warning: string | null;
  data_state: DataState;
}

export interface LoadStage {
  stage: string;
  status: "pending" | "running" | "ready" | "provisional" | "failed" | "skipped";
  required: boolean;
  message: string | null;
  retry_after_s: number | null;
}

export interface FarmLoadStatus {
  state: "not_started" | "loading" | "ready";
  progress: number;
  soil_final: boolean;
  stages: LoadStage[];
  poll_after_s: number | null;
  warnings: string[];
}

export interface FarmAnalyzeResponse {
  declared_inputs?: DeclaredInputs | null;
  land_cover?: LandCover | null;
  load_status?: FarmLoadStatus | null;
  farm: Farm;
  data_mode: DataMode;
  catalog_version: string;
  latest_ndvi: Record<string, number | null>;
  latest_ndvi_date: string | null;
  latest_ndvi_source: string | null;
  warnings: string[];
}

export interface TwinScenario {
  precip_factor: number;
  temp_delta_c: number;
  irrigation_level: IrrigationLevel | null;
  preset: string | null;
}

export interface TwinState {
  date: string;
  crop_id: string;
  stage: PhenoStage;
  gdd_day: number;
  gdd_cum: number;
  kc: number;
  root_depth_m: number;
  taw_mm: number;
  raw_mm: number;
  root_zone_depletion_mm: number;
  soil_water_fraction: number;
  ks: number;
  et0_mm: number;
  etc_mm: number;
  etc_adj_mm: number;
  precip_mm: number;
  effective_precip_mm: number;
  runoff_mm: number;
  irrigation_mm: number;
  drainage_mm: number;
  t_max: number;
  t_min: number;
  data_state: DataState;
}

export interface Discrepancy {
  date: string;
  variable: string;
  observed: number;
  simulated: number;
  delta: number;
}

export interface ComparisonMetrics {
  variable: string;
  source_id: string;
  n_points: number;
  correlation: number | null;
  mean_abs_delta: number | null;
  observed_peak_date: string | null;
  simulated_peak_date: string | null;
  lag_days: number | null;
  note: string;
  data_state: DataState;
}

export interface StageDates {
  planting: string | null;
  development: string | null;
  mid_season: string | null;
  late_season: string | null;
  maturity: string | null;
}

export interface ZoneSummary {
  mean_ks: number;
  min_ks: number;
  stress_days: number;
  stress_class: StressClass;
  min_soil_water_fraction: number;
  mean_soil_water_fraction: number;
  total_precip_mm: number;
  total_effective_precip_mm: number;
  total_irrigation_mm: number;
  total_runoff_mm: number;
  total_drainage_mm: number;
  total_et0_mm: number;
  total_etc_adj_mm: number;
  gdd_total: number;
  frost_days: number;
  hot_days: number;
  cold_days: number;
  stage_dates: StageDates;
  irrigation_events: number;
}

export interface MonteCarloSummary {
  n: number;
  seed: number;
  perturbed: Record<string, string>;
  mean_ks_p10: number;
  mean_ks_p50: number;
  mean_ks_p90: number;
  stress_days_p10: number;
  stress_days_p50: number;
  stress_days_p90: number;
  min_soil_water_fraction_p10: number;
  min_soil_water_fraction_p50: number;
  min_soil_water_fraction_p90: number;
  data_state: DataState;
}

export interface ZoneResult {
  zone_id: string;
  name: string;
  crop_id: string;
  area_ha: number;
  planting_date: string;
  crop_state?: DataState;
  planting_state?: DataState;
  irrigation_level: IrrigationLevel;
  states: TwinState[];
  summary: ZoneSummary;
  ndvi: number | null;
  ndvi_date: string | null;
  ndvi_state: DataState;
  ndvi_source: string | null;
  discrepancies: Discrepancy[];
  comparison: ComparisonMetrics[];
  expected_canopy: { date: string; value: number }[];
  monte_carlo: MonteCarloSummary | null;
  data_state: DataState;
  warnings: string[];
}

export interface FarmSummary {
  area_ha: number;
  mean_ks_area_weighted: number;
  stress_class: StressClass;
  mean_soil_water_fraction: number;
  total_precip_mm: number;
  total_irrigation_mm: number;
  note: string;
}

export interface TwinSimulateResponse {
  methodology: string;
  catalog_version: string;
  data_mode: DataMode;
  twin_level: TwinLevel;
  farm_id: string;
  start: string;
  end: string;
  scenario: TwinScenario;
  scenario_expanded: { precip_factor: number; temp_delta_c: number; irrigation_level: IrrigationLevel | null; preset: string | null };
  zones: ZoneResult[];
  farm_summary: FarmSummary;
  warnings: string[];
  provenance: Record<string, Provenance>;
}

export interface TwinSimulateRequest {
  farm_id: string;
  start: string;
  end: string;
  reference_year?: number | null;
  scenario: Partial<TwinScenario>;
  fork_date?: string | null;
  // crop_id -> ISO planting date (the backend keys planting dates by crop, not by zone)
  planting_dates?: Record<string, string>;
  // zone_id -> catalog crop_id declared by the user (DECLARED); only sent when it differs from the farm's crop
  crop_overrides?: Record<string, string>;
  crop_override_state?: "SIMULATED" | null;
  monte_carlo?: { n: number; seed: number } | null;
  include_states?: boolean;
  include_comparison?: boolean;
}

export interface ObservationPoint {
  date: string;
  variable: "ndvi" | "soil_moisture";
  value: number;
  zone_id: string | null;
  n_pixels: number | null;
  qa_flag: string | null;
  valid_fraction?: number | null;
  p10?: number | null;
  p90?: number | null;
}

export interface ObservationSeries {
  variable: "ndvi" | "soil_moisture";
  source_id: string;
  resolution_m: number;
  points: ObservationPoint[];
  provenance: Provenance;
  warnings: string[];
}

export interface NdviOverlay {
  farm_id: string;
  date: string;
  source: string;
  resolution_m: number;
  bounds: { west: number; south: number; east: number; north: number };
  width_px: number;
  height_px: number;
  png_base64: string;
  data_state: DataState;
  legend_stops: { value: number; color: string }[];
  warnings: string[];
}

export interface TwinConfig {
  irrigation_levels: Record<IrrigationLevel, { depth_mm: number; trigger_fraction_of_raw: number }>;
  presets: Record<string, { precip_factor: number; temp_delta_c: number; description: string }>;
  stress_class_thresholds_mean_ks: { min_ks: number; class: StressClass }[];
  stress_day_ks: number;
  default_planting_mmdd: Record<string, string>;
  note: string;
}

export interface ClimateMetric {
  value: number | null;
  unit: string;
  data_state: DataState;
  source: string | null;
}

// ─────────────────────────────────────────
// Section: Imagery, terrain and region contracts (data agent, see docs/01-architecture/data-contracts.md)
// ─────────────────────────────────────────

// The backend may still be building these endpoints: the frontend normalises tolerant shapes in guards.ts
// and falls back to procedural assets when a call fails, so the UI never blocks on them.

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface BasemapInfo {
  available: boolean;
  source: string | null;
  resolution_m: number | null;
  date: string | null;
  data_state: DataState;
}

export interface ImageryMeta {
  farm_id: string;
  bounds: GeoBounds;
  crs: string;
  basemap: BasemapInfo | null;
  ndvi_dates: string[];
  ndvi_source: string | null;
  warnings: string[];
}

export interface NdviDates {
  farm_id: string;
  source: string | null;
  dates: string[];
  warnings: string[];
}

export interface Heightmap {
  farm_id: string;
  bounds: GeoBounds;
  width: number;
  height: number;
  // Row-major, first row = north edge; metres above sea level
  elevations_m: number[];
  min_m: number;
  max_m: number;
  resolution_m: number | null;
  source: string | null;
  data_state: DataState;
  warnings: string[];
}

export interface RegionMetric {
  value: number | null;
  unit: string;
  // Absolute change vs the reference period (same unit); null when no reference exists
  delta: number | null;
  delta_pct: number | null;
  reference: string;
  data_state: DataState;
  source: string | null;
}

export interface AptitudeEntry {
  crop_id: string;
  // GAEZ v4 suitability index 0–100 (SI) — a comparative index, never a probability
  index: number | null;
  suitability_class: string | null;
  data_state: DataState;
}

export interface RegionSummary {
  region_name: string;
  period_start: string;
  period_end: string;
  previous_start: string | null;
  previous_end: string | null;
  ndvi: RegionMetric;
  precipitation: RegionMetric;
  temperature: RegionMetric;
  radiation: RegionMetric;
  ndvi_series: { date: string; value: number }[];
  aptitude: AptitudeEntry[] | null;
  aptitude_source: string | null;
  warnings: string[];
  // Where the numbers came from: "api" (region/summary) or "climate+modis" (frontend fallback)
  origin: "api" | "fallback";
}

export interface WeatherDay {
  date: string;
  t_mean: number;
  t_max: number;
  t_min: number;
  precip: number;
  rh_mean: number;
  solar_rad: number;
  wind_2m: number;
  qa_flags: string[];
}

export interface ClimateIndicatorMetric {
  value: number | null;
  unit: string;
  data_state: DataState;
  source: string | null;
}

export interface ClimateResponse {
  methodology: string;
  data_mode: DataMode;
  series: {
    location: Location;
    elevation_m: number;
    days: WeatherDay[];
    provenance: Provenance;
    warnings: string[];
  };
  indicators: Record<string, unknown>;
  warnings: string[];
}
