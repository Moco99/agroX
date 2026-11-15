import { create } from "zustand";
import { api } from "../services/api";
import { buildRegionFallback } from "../lib/region";
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

export const FARM_ID = "story_pilot_farm";
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

export function isNeutral(c: ScenarioControls): boolean {
  return c.precipPct === 0 && c.tempDelta === 0 && c.irrigation === "NONE" && !c.monteCarlo;
}

interface TwinStore {
  screen: Screen;
  canvasTab: CanvasTab;
  layer: Layer;
  year: number;
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
  loadContext: () => Promise<void>;
  setCanvasTab: (t: CanvasTab) => void;
  setLayer: (l: Layer) => void;
  setDayIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  selectZone: (id: string | null) => void;
  setControls: (patch: Partial<ScenarioControls>) => void;
  applyPreset: (name: string) => void;
  init: () => Promise<void>;
  loadSeason: (year: number) => Promise<void>;
  runScenario: () => Promise<void>;
}

// ─────────────────────────────────────────
// Section: Store
// ─────────────────────────────────────────

let simulateAbort: AbortController | null = null;
let simulateTimer: ReturnType<typeof setTimeout> | null = null;

function scenarioRequest(year: number, c: ScenarioControls, forkDate: string | null): TwinSimulateRequest {
  const { start, end } = seasonRange(year);
  return {
    farm_id: FARM_ID,
    start,
    end,
    scenario: {
      precip_factor: Math.round((1 + c.precipPct / 100) * 1000) / 1000,
      temp_delta_c: c.tempDelta,
      irrigation_level: c.irrigation === "NONE" ? null : c.irrigation,
      preset: null,
    },
    fork_date: forkDate,
    monte_carlo: c.monteCarlo ? { n: 40, seed: 20261114 } : null,
    include_states: true,
    include_comparison: false,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useTwinStore = create<TwinStore>((set, get) => ({
  screen: "twin",
  canvasTab: "twin",
  layer: "ndvi",
  year: 2024,
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

  init: async () => {
    set({ loading: true, error: null });
    try {
      const [health, config, farm] = await Promise.all([api.health(), api.config(), api.farm(FARM_ID)]);
      set({ health, config, farm });
      // Observations are optional context: a missing source must not block the twin
      const [modis, sentinel2, smap, overlay] = await Promise.all([
        api.ndvi(FARM_ID, "modis_ndvi").catch(() => null),
        api.ndvi(FARM_ID, "sentinel2").catch(() => null),
        api.soilMoisture(FARM_ID).catch(() => null),
        api.overlay(FARM_ID).catch(() => null),
      ]);
      set({ modis, sentinel2, smap, overlay });
      await get().loadSeason(get().year);
      // Imagery, terrain and regional context are loaded after the twin so they never delay the first frame
      void get().loadContext();
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
    }
  },

  loadContext: async () => {
    const { year, modis } = get();
    const cur = regionPeriod(year);
    const prev = regionPeriod(year - 1);
    const [meta, dates, heightmap, regionApi, climate, climatePrev] = await Promise.all([
      api.imageryMeta(FARM_ID).catch(() => null),
      api.ndviDates(FARM_ID).catch(() => null),
      api.heightmap(FARM_ID).catch(() => null),
      api.regionSummary(cur.start, cur.end).catch(() => null),
      api.climate(FARM_ID, cur.start, cur.end).catch(() => null),
      api.climate(FARM_ID, prev.start, prev.end).catch(() => null),
    ]);
    // The real endpoint wins; otherwise the panel is assembled from POWER + MODIS (both already served)
    const region =
      regionApi ??
      (climate
        ? buildRegionFallback({
            regionName: REGION_NAME,
            current: climate,
            previous: climatePrev,
            previousLabel: `vs. temporada ${year - 1}`,
            modis,
            periodStart: cur.start,
            periodEnd: cur.end,
            previousStart: prev.start,
            previousEnd: prev.end,
          })
        : null);
    const ndviDates = dates?.dates.length ? dates.dates : (meta?.ndvi_dates ?? []);
    const sorted = [...ndviDates].sort();
    // Default to the last available scene (usually the closest to harvest, the richest NDVI pattern)
    const ndviDate = get().ndviDate ?? sorted[sorted.length - 1] ?? get().overlay?.date ?? null;
    set({ imageryMeta: meta, ndviDates: sorted, ndviDate, heightmap, region, climate, climatePrev, contextLoaded: true });
  },

  loadSeason: async (year) => {
    set({ loading: true, error: null, year, playing: false });
    try {
      const { start, end } = seasonRange(year);
      const baseline = await api.simulate({
        farm_id: FARM_ID,
        start,
        end,
        scenario: {},
        include_states: true,
        include_comparison: true,
      });
      // Open on mid-July so the first view shows a developed canopy instead of bare April soil
      const first = baseline.zones[0]?.states ?? [];
      const july = first.findIndex((s) => s.date >= `${year}-07-15`);
      set({
        baseline,
        scenario: null,
        dayIndex: july >= 0 ? july : 0,
        loading: false,
        selectedZoneId: get().selectedZoneId ?? baseline.zones[0]?.zone_id ?? null,
      });
      if (!isNeutral(get().controls)) await get().runScenario();
      if (get().contextLoaded) void get().loadContext();
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
    }
  },

  runScenario: async () => {
    const { controls, year, baseline, dayIndex } = get();
    if (isNeutral(controls)) {
      set({ scenario: null, simulating: false });
      return;
    }
    simulateAbort?.abort();
    simulateAbort = new AbortController();
    const forkDate = controls.forkFromCurrent ? (baseline?.zones[0]?.states[dayIndex]?.date ?? null) : null;
    set({ simulating: true });
    try {
      const scenario = await api.simulate(scenarioRequest(year, controls, forkDate), simulateAbort.signal);
      set({ scenario, simulating: false, error: null });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      set({ error: errorMessage(e), simulating: false });
    }
  },
}));
