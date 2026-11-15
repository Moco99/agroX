import { create } from "zustand";
import { api, ApiError } from "../services/api";
import { buildRegionFallback } from "../lib/region";
import { isPilotFarm, parseParcelId } from "../lib/parcel";
import { buildRunPlan, type RunPlan } from "../lib/run-plan";
import { useParcelStore, type SourceKey } from "./parcel-store";
import type {
  ClimateResponse,
  FarmAnalyzeResponse,
  Health,
  Heightmap,
  ImageryMeta,
  IrrigationLevel,
  NdviOverlay,
  ObservationSeries,
  RegionSummary,
  TwinConfig,
  TwinSimulateRequest,
  TwinSimulateResponse,
} from "../types/api";

// ─────────────────────────────────────────
// Section: Types
// ─────────────────────────────────────────

export type Screen = "twin" | "parcel";
export type Layer = "ndvi" | "stress" | "moisture" | "temperature" | "irrigation";
export type CanvasTab = "twin" | "map2d" | "satellite";
// Toggleable layers of the globe/map stages (mockups 12–13); each one drives a real visual, see layer-bar
export type MapLayer = "ndvi" | "precipitation" | "temperature" | "boundaries";

export interface ScenarioControls {
  // Percent change of daily rain (-80 = 80 % less); sent as precip_factor = 1 + pct/100
  precipPct: number;
  tempDelta: number;
  irrigation: IrrigationLevel;
  preset: string;
  forkFromCurrent: boolean;
  monteCarlo: boolean;
}

export const SEASONS = [2024, 2023] as const;
export const DEFAULT_CONTROLS: ScenarioControls = {
  precipPct: 0,
  tempDelta: 0,
  irrigation: "NONE",
  preset: "baseline",
  forkFromCurrent: false,
  monteCarlo: false,
};

export function seasonRange(year: number): { start: string; end: string } {
  return { start: `${year}-04-01`, end: `${year}-10-31` };
}

// Growing-season window used for the regional KPIs (May–Sep, the corn/soy season of the pilot)
export function regionPeriod(year: number): { start: string; end: string } {
  return { start: `${year}-05-01`, end: `${year}-09-30` };
}

export const REGION_NAME = "Story County, Iowa (EE. UU.)";

// Pilot-only climate comparison label; other parcels name themselves by coordinates
export function regionNameFor(farmId: string): string {
  const p = parseParcelId(farmId);
  return p ? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` : REGION_NAME;
}

export interface SeasonSpan {
  start: string;
  end: string;
}

export function isNeutral(c: ScenarioControls): boolean {
  return c.precipPct === 0 && c.tempDelta === 0 && c.irrigation === "NONE" && !c.monteCarlo;
}

interface TwinStore {
  screen: Screen;
  canvasTab: CanvasTab;
  layer: Layer;
  year: number;
  // Simulation window actually requested: the pilot's season, or the span around the declared planting date
  span: SeasonSpan;
  plan: RunPlan | null;
  dayIndex: number;
  playing: boolean;
  selectedZoneId: string | null;
  controls: ScenarioControls;
  health: Health | null;
  config: TwinConfig | null;
  farm: FarmAnalyzeResponse | null;
  baseline: TwinSimulateResponse | null;
  scenario: TwinSimulateResponse | null;
  modis: ObservationSeries | null;
  sentinel2: ObservationSeries | null;
  smap: ObservationSeries | null;
  overlay: NdviOverlay | null;
  // Context for the cinematic stages; every field may stay null when its endpoint is not served yet
  climate: ClimateResponse | null;
  climatePrev: ClimateResponse | null;
  imageryMeta: ImageryMeta | null;
  ndviDates: string[];
  ndviDate: string | null;
  ndviPlaying: boolean;
  heightmap: Heightmap | null;
  region: RegionSummary | null;
  contextLoaded: boolean;
  hoverZoneId: string | null;
  mapLayers: Record<MapLayer, boolean>;
  loading: boolean;
  simulating: boolean;
  error: string | null;
  setScreen: (s: Screen) => void;
  setNdviDate: (d: string | null) => void;
  setNdviPlaying: (p: boolean) => void;
  setHoverZone: (id: string | null) => void;
  toggleMapLayer: (l: MapLayer) => void;
  setCanvasTab: (t: CanvasTab) => void;
  setLayer: (l: Layer) => void;
  setDayIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  selectZone: (id: string | null) => void;
  setControls: (patch: Partial<ScenarioControls>) => void;
  applyPreset: (name: string) => void;
  // Loads (or reloads) the active parcel; a new call cancels the one in flight
  init: () => Promise<void>;
  cancelLoad: () => void;
  loadSeason: (year: number) => Promise<void>;
  // Re-simulates the baseline after the user declares crop or planting dates
  applyDeclaration: () => Promise<void>;
  // Re-requests the farm only (soil provisional -> real) and refreshes the simulation
  refreshFarm: () => Promise<void>;
  runScenario: () => Promise<void>;
}

// ─────────────────────────────────────────
// Section: Helpers
// ─────────────────────────────────────────

let simulateAbort: AbortController | null = null;
let simulateTimer: ReturnType<typeof setTimeout> | null = null;
let loadAbort: AbortController | null = null;
let loadTimer: ReturnType<typeof setTimeout> | null = null;

// Gives up after this many polls: a source that never recovers is reported by the retry button instead
const WATCH_POLL_MAX = 40;
const POLL_MIN_S = 2;
const FINAL_STATUS = new Set(["ready", "provisional", "skipped", "failed"]);

function stopLoadWatch(): void {
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

// Status of one backend load stage; null when the farm has no staged loading (pilot, derived/ data)
function stageStatus(farm: FarmAnalyzeResponse | null, name: string): string | null {
  const stage = farm?.load_status?.stages.find((s) => s.stage === name);
  return stage ? stage.status : null;
}

// A resource may be requested when its stage is ready or the farm has no staged loading at all
function stageUsable(farm: FarmAnalyzeResponse | null, name: string): boolean {
  const s = stageStatus(farm, name);
  return s === null || s === "ready" || s === "provisional";
}

// The first farm response of a new live parcel returns at once with load_status: poll (cheap, cached upstream) until
// the required stages (terrain, soil, weather) are final, publishing each answer so the panel shows real progress
async function fetchFarmWhenReady(farmId: string, signal: AbortSignal): Promise<FarmAnalyzeResponse> {
  for (;;) {
    const farm = await api.farm(farmId, signal);
    const status = farm.load_status;
    if (!status) return farm;
    useTwinStore.setState({ farm });
    // Soil is slow and has a marked provisional stand-in: the twin starts without it and refreshes when it is real
    const required = status.stages.filter((s) => s.required && s.stage !== "soil");
    const failed = required.find((s) => s.status === "failed");
    if (failed) throw new Error(`${failed.stage}: ${failed.message ?? "falló"}`);
    if (required.every((s) => FINAL_STATUS.has(s.status))) return farm;
    await sleep(Math.max(POLL_MIN_S, status.poll_after_s ?? 3) * 1000, signal);
  }
}

// After the twin is up, optional stages (NDVI, imagery, relief) and the real soil keep arriving: poll the farm and
// refresh exactly what each finished stage feeds
function watchLoad(farmId: string, signal: AbortSignal, attempt = 0): void {
  const before = useTwinStore.getState().farm;
  const status = before?.load_status;
  if (!status || (status.state === "ready" && status.soil_final) || attempt >= WATCH_POLL_MAX) return;
  const delayS = Math.max(POLL_MIN_S + 2, status.poll_after_s ?? 6);
  loadTimer = setTimeout(async () => {
    if (signal.aborted || useParcelStore.getState().farmId !== farmId) return;
    try {
      const farm = await api.farm(farmId, signal);
      useTwinStore.setState({ farm });
      const became = (name: string) => stageStatus(before, name) !== "ready" && stageStatus(farm, name) === "ready";
      const soilNow = farm.load_status?.soil_final === true && status.soil_final === false;
      if (became("ndvi")) await loadObservations(farm, signal);
      if (became("ndvi") || became("basemap") || became("heightmap")) {
        const { span } = useTwinStore.getState();
        await loadContext(farm, span, signal);
      }
      if (soilNow) await useTwinStore.getState().applyDeclaration();
    } catch (e) {
      if (isAbort(e)) return;
    }
    watchLoad(farmId, signal, attempt + 1);
  }, delayS * 1000);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Fields that belong to one parcel; cleared whenever the active parcel changes so no stale data is ever shown
const PARCEL_RESET = {
  farm: null,
  baseline: null,
  scenario: null,
  modis: null,
  sentinel2: null,
  smap: null,
  overlay: null,
  climate: null,
  climatePrev: null,
  imageryMeta: null,
  ndviDates: [] as string[],
  ndviDate: null,
  ndviPlaying: false,
  heightmap: null,
  region: null,
  contextLoaded: false,
  selectedZoneId: null,
  dayIndex: 0,
  playing: false,
  plan: null,
  simulating: false,
};

// Declared / suggested planting dates and crop overrides ride along every request of a non-pilot parcel
function planExtras(plan: RunPlan | null): Pick<TwinSimulateRequest, "planting_dates" | "zone_crops"> {
  if (!plan) return {};
  const out: Pick<TwinSimulateRequest, "planting_dates" | "zone_crops"> = {};
  if (Object.keys(plan.plantingDates).length) out.planting_dates = plan.plantingDates;
  if (Object.keys(plan.cropOverrides).length) out.zone_crops = plan.cropOverrides;
  return out;
}

function scenarioRequest(
  farmId: string,
  span: SeasonSpan,
  plan: RunPlan | null,
  c: ScenarioControls,
  forkDate: string | null,
): TwinSimulateRequest {
  return {
    farm_id: farmId,
    start: span.start,
    end: span.end,
    scenario: {
      precip_factor: Math.round((1 + c.precipPct / 100) * 1000) / 1000,
      temp_delta_c: c.tempDelta,
      irrigation_level: c.irrigation === "NONE" ? null : c.irrigation,
      preset: null,
    },
    ...planExtras(plan),
    fork_date: forkDate,
    monte_carlo: c.monteCarlo ? { n: 40, seed: 20261114 } : null,
    include_states: true,
    include_comparison: false,
  };
}

function baselineRequest(farmId: string, span: SeasonSpan, plan: RunPlan | null): TwinSimulateRequest {
  return {
    farm_id: farmId,
    start: span.start,
    end: span.end,
    scenario: {},
    ...planExtras(plan),
    include_states: true,
    include_comparison: true,
  };
}

function planFor(farm: FarmAnalyzeResponse, health: Health | null): RunPlan | null {
  if (isPilotFarm(farm.farm.farm_id)) return null;
  const { declaration, catalog } = useParcelStore.getState();
  return buildRunPlan({
    zones: farm.farm.zones.map((z) => ({ zone_id: z.zone_id, crop_id: z.crop_id })),
    lat: farm.farm.centroid.lat,
    declaration,
    catalog,
    coverageEnd: health?.weather_coverage.end ?? new Date().toISOString().slice(0, 10),
    suggestedSeason: farm.declared_inputs?.suggested_season ?? null,
    suggestedPlanting: farm.declared_inputs?.suggested_planting_dates ?? null,
  });
}

// Runs one named source of the parcel load: records ok/error for the progress panel and never throws (except
// on abort), because only the farm and the simulation are critical
async function track<T>(key: SourceKey, task: Promise<T>, optional = false): Promise<T | null> {
  try {
    const out = await task;
    useParcelStore.getState().markSource(key, "ok");
    return out;
  } catch (e) {
    if (isAbort(e)) throw e;
    // An optional resource the backend does not serve for this parcel (404/501) is a fallback, not a failure
    const missing = optional && e instanceof ApiError && (e.status === 404 || e.status === 501);
    useParcelStore.getState().markSource(key, missing ? "skipped" : "error", errorMessage(e));
    return null;
  }
}

// Index of the day to open on: mid-season so the first view shows a developed canopy, not bare soil
function openingDay(baseline: TwinSimulateResponse, pilot: boolean, year: number): number {
  const first = baseline.zones[0]?.states ?? [];
  if (pilot) {
    const i = first.findIndex((s) => s.date >= `${year}-07-15`);
    return i >= 0 ? i : 0;
  }
  return Math.max(0, Math.floor(first.length * 0.55));
}

// ─────────────────────────────────────────
// Section: Store
// ─────────────────────────────────────────

export const useTwinStore = create<TwinStore>((set, get) => ({
  screen: "twin",
  canvasTab: "twin",
  layer: "ndvi",
  year: 2024,
  span: seasonRange(2024),
  plan: null,
  dayIndex: 0,
  playing: false,
  selectedZoneId: null,
  controls: DEFAULT_CONTROLS,
  health: null,
  config: null,
  farm: null,
  baseline: null,
  scenario: null,
  modis: null,
  sentinel2: null,
  smap: null,
  overlay: null,
  climate: null,
  climatePrev: null,
  imageryMeta: null,
  ndviDates: [],
  ndviDate: null,
  ndviPlaying: false,
  heightmap: null,
  region: null,
  contextLoaded: false,
  hoverZoneId: null,
  mapLayers: { ndvi: true, precipitation: false, temperature: false, boundaries: true },
  loading: true,
  simulating: false,
  error: null,

  setScreen: (screen) => set({ screen }),
  setNdviDate: (ndviDate) => set({ ndviDate }),
  setNdviPlaying: (ndviPlaying) => set({ ndviPlaying }),
  setHoverZone: (hoverZoneId) => set({ hoverZoneId }),
  toggleMapLayer: (l) => set((s) => ({ mapLayers: { ...s.mapLayers, [l]: !s.mapLayers[l] } })),
  setCanvasTab: (canvasTab) => set({ canvasTab }),
  setLayer: (layer) => set({ layer }),
  setDayIndex: (dayIndex) => set({ dayIndex }),
  setPlaying: (playing) => set({ playing }),
  selectZone: (selectedZoneId) => set({ selectedZoneId }),

  setControls: (patch) => {
    const controls = { ...get().controls, ...patch };
    // Touching a slider turns the preset into a custom scenario so the label never lies
    const touched = "precipPct" in patch || "tempDelta" in patch;
    set({ controls: touched ? { ...controls, preset: "custom" } : controls });
    // Under a scenario the twin does not simulate NDVI, so stress becomes the honest default layer
    if (!isNeutral(controls) && get().layer === "ndvi") set({ layer: "stress" });
    if (simulateTimer) clearTimeout(simulateTimer);
    simulateTimer = setTimeout(() => void get().runScenario(), 250);
  },

  applyPreset: (name) => {
    const preset = get().config?.presets[name];
    if (!preset) return;
    get().setControls({
      precipPct: Math.round((preset.precip_factor - 1) * 100),
      tempDelta: preset.temp_delta_c,
    });
    set((s) => ({ controls: { ...s.controls, preset: name } }));
  },

  cancelLoad: () => {
    loadAbort?.abort();
    loadAbort = null;
    stopLoadWatch();
    simulateAbort?.abort();
    set({ loading: false, simulating: false });
    useParcelStore.getState().finishLoad("cancelled");
  },

  init: async () => {
    loadAbort?.abort();
    simulateAbort?.abort();
    if (simulateTimer) clearTimeout(simulateTimer);
    stopLoadWatch();
    const ctl = new AbortController();
    loadAbort = ctl;
    const { signal } = ctl;
    const parcel = useParcelStore.getState();
    const farmId = parcel.farmId;
    const pilot = isPilotFarm(farmId);
    // A new parcel starts from neutral controls and a clean slate; the previous parcel's data must not leak
    set({ ...PARCEL_RESET, controls: DEFAULT_CONTROLS, loading: true, error: null });
    parcel.beginLoad();
    try {
      // Health, scenario config and crop catalog are small and fast; the catalog is optional (the pilot never needs it)
      const [health, config, catalog] = await Promise.all([
        get().health ?? api.health(signal),
        get().config ?? api.config(signal),
        parcel.catalog ?? api.crops(signal).catch(() => null),
      ]);
      parcel.setHealth(health);
      parcel.setCatalog(catalog);
      set({ health, config });

      // The farm call is the slow one for a new parcel (SoilGrids + first NDVI), so it runs alone: concurrent
      // requests would make the backend repeat the same upstream work and hit the SoilGrids rate limit
      const farm = await fetchFarmWhenReady(farmId, signal);
      parcel.markSource("farm", "ok");
      const plan = planFor(farm, health);
      const span = pilot ? seasonRange(get().year) : (plan?.span ?? get().span);
      set({ farm, plan, span, selectedZoneId: farm.farm.zones[0]?.zone_id ?? null });

      // Simulation is critical; observations and context are optional and each reports its own failure
      const simulation = api.simulate(baselineRequest(farmId, span, plan), signal).then((baseline) => {
        if (signal.aborted) return baseline;
        set({ baseline, scenario: null, dayIndex: openingDay(baseline, pilot, get().year) });
        parcel.markSource("simulation", "ok");
        return baseline;
      });
      simulation.catch((e: unknown) => {
        if (!isAbort(e)) parcel.markSource("simulation", "error", errorMessage(e));
      });
      const observations = track("ndvi", loadObservations(farm, signal));
      const context = loadContext(farm, span, signal);
      const [baseline] = await Promise.all([simulation, observations, context]);
      if (signal.aborted) return;
      set({ loading: false, selectedZoneId: baseline.zones[0]?.zone_id ?? null });
      parcel.finishLoad("ready");
      watchLoad(farmId, signal);
    } catch (e) {
      if (isAbort(e) || signal.aborted) return;
      set({ error: errorMessage(e), loading: false });
      if (useParcelStore.getState().sources.farm.state === "pending") parcel.markSource("farm", "error", errorMessage(e));
      parcel.finishLoad("error");
    }
  },

  loadSeason: async (year) => {
    // Season selection exists only for the pilot (its CDL years); other parcels derive the window from the plan
    if (!isPilotFarm(useParcelStore.getState().farmId)) return;
    set({ year, span: seasonRange(year), playing: false });
    await get().init();
  },

  applyDeclaration: async () => {
    const { farm, health } = get();
    if (!farm || isPilotFarm(farm.farm.farm_id)) return;
    const plan = planFor(farm, health);
    const span = plan?.span ?? get().span;
    simulateAbort?.abort();
    simulateAbort = new AbortController();
    const { signal } = simulateAbort;
    set({ plan, span, simulating: true, error: null });
    try {
      const baseline = await api.simulate(baselineRequest(farm.farm.farm_id, span, plan), signal);
      set({ baseline, scenario: null, dayIndex: openingDay(baseline, false, get().year), simulating: false });
      if (!isNeutral(get().controls)) await get().runScenario();
      // The climate window follows the simulation window; failure here only leaves the previous summary in place
      void loadContext(farm, span, signal).catch(() => undefined);
    } catch (e) {
      if (isAbort(e)) return;
      set({ error: errorMessage(e), simulating: false });
    }
  },

  refreshFarm: async () => {
    const farmId = useParcelStore.getState().farmId;
    loadAbort?.abort();
    const ctl = new AbortController();
    loadAbort = ctl;
    useParcelStore.getState().markSource("farm", "pending");
    try {
      const farm = await api.farm(farmId, ctl.signal);
      useParcelStore.getState().markSource("farm", "ok");
      set({ farm });
      await get().applyDeclaration();
    } catch (e) {
      if (isAbort(e)) return;
      useParcelStore.getState().markSource("farm", "error", errorMessage(e));
    }
  },

  runScenario: async () => {
    const { controls, span, plan, baseline, dayIndex, farm } = get();
    if (isNeutral(controls) || !farm) {
      set({ scenario: null, simulating: false });
      return;
    }
    simulateAbort?.abort();
    simulateAbort = new AbortController();
    const forkDate = controls.forkFromCurrent ? (baseline?.zones[0]?.states[dayIndex]?.date ?? null) : null;
    set({ simulating: true });
    try {
      const scenario = await api.simulate(
        scenarioRequest(farm.farm.farm_id, span, plan, controls, forkDate),
        simulateAbort.signal,
      );
      set({ scenario, simulating: false, error: null });
    } catch (e) {
      if (isAbort(e)) return;
      set({ error: errorMessage(e), simulating: false });
    }
  },
}));

// ─────────────────────────────────────────
// Section: Loaders (observations and context of the active parcel)
// ─────────────────────────────────────────

async function loadObservations(farm: FarmAnalyzeResponse, signal: AbortSignal): Promise<void> {
  const farmId = farm.farm.farm_id;
  const pilot = isPilotFarm(farmId);
  // Sentinel-2 still being fetched by the backend: the watcher reloads it when the stage finishes
  if (!stageUsable(farm, "ndvi")) return;
  // MODIS, SMAP and the provisional overlay exist only for the pilot; a missing source must not block the twin
  const [sentinel2, modis, smap, overlay] = await Promise.all([
    api.ndvi(farmId, "sentinel2", signal),
    pilot ? api.ndvi(farmId, "modis_ndvi", signal).catch(() => null) : Promise.resolve(null),
    pilot ? api.soilMoisture(farmId, signal).catch(() => null) : Promise.resolve(null),
    pilot ? api.overlay(farmId, signal).catch(() => null) : Promise.resolve(null),
  ]);
  if (signal.aborted) return;
  useTwinStore.setState({ sentinel2, modis, smap, overlay });
}

async function loadContext(farm: FarmAnalyzeResponse, span: SeasonSpan, signal: AbortSignal): Promise<void> {
  const farmId = farm.farm.farm_id;
  const pilot = isPilotFarm(farmId);
  const { lat, lon } = farm.farm.centroid;
  const pilotYear = useTwinStore.getState().year;
  const cur = pilot ? regionPeriod(pilotYear) : span;
  const prev = regionPeriod(pilotYear - 1);

  const imagery = stageUsable(farm, "basemap")
    ? track("imagery", Promise.all([api.imageryMeta(farmId, signal), api.ndviDates(farmId, signal).catch(() => null)]), true)
    : Promise.resolve(null);
  const terrain = stageUsable(farm, "heightmap") ? track("terrain", api.heightmap(farmId, signal), true) : Promise.resolve(null);
  const climate = track("climate", api.climate(pilot ? { farmId } : { lat, lon }, cur.start, cur.end, signal));
  // The previous-season climate and the regional summary only feed the pilot's comparison panel
  const climatePrev = pilot ? api.climate({ farmId }, prev.start, prev.end, signal).catch(() => null) : Promise.resolve(null);
  const regionApi = pilot ? api.regionSummary(cur.start, cur.end, signal).catch(() => null) : Promise.resolve(null);

  const [imageryRes, heightmap, climateRes, climatePrevRes, regionRes] = await Promise.all([
    imagery,
    terrain,
    climate,
    climatePrev,
    regionApi,
  ]);
  if (signal.aborted) return;
  const state = useTwinStore.getState();
  const meta = imageryRes?.[0] ?? null;
  const dates = imageryRes?.[1] ?? null;
  // A missing imagery endpoint is an expected fallback (colour per zone), not an error worth alarming the user about
  const region =
    regionRes ??
    (pilot && climateRes
      ? buildRegionFallback({
          regionName: REGION_NAME,
          current: climateRes,
          previous: climatePrevRes,
          previousLabel: `vs. temporada ${pilotYear - 1}`,
          modis: state.modis,
          periodStart: cur.start,
          periodEnd: cur.end,
          previousStart: prev.start,
          previousEnd: prev.end,
        })
      : null);
  // Dated scenes: the dates endpoint, else the imagery meta, else the dates actually present in the NDVI series
  const fromSeries = [...new Set((state.sentinel2?.points ?? []).map((p) => p.date))];
  const ndviDates = dates?.dates.length ? dates.dates : meta?.ndvi_dates.length ? meta.ndvi_dates : fromSeries;
  const sorted = [...ndviDates].sort();
  // Default to the last available scene (usually the closest to harvest, the richest NDVI pattern)
  const ndviDate = state.ndviDate ?? sorted[sorted.length - 1] ?? state.overlay?.date ?? null;
  useTwinStore.setState({
    // A stage that was not requested this round (still loading upstream) keeps what an earlier round loaded
    imageryMeta: meta ?? state.imageryMeta,
    ndviDates: sorted.length ? sorted : state.ndviDates,
    ndviDate,
    heightmap: heightmap ?? state.heightmap,
    region,
    climate: climateRes ?? state.climate,
    climatePrev: climatePrevRes,
    contextLoaded: true,
  });
}
