import type { Layer } from "../store/twin-store";
import {
  IRRIGATION_RAMP,
  MOISTURE_RAMP,
  NDVI_NODATA,
  NDVI_RAMP,
  STRESS_RAMP,
  TEMPERATURE_RAMP,
  rampColor,
  type RampStop,
} from "../styles/tokens";
import type {
  DataState,
  ObservationPoint,
  ObservationSeries,
  StressClass,
  TwinSimulateResponse,
  TwinState,
  ZoneResult,
} from "../types/api";

// ─────────────────────────────────────────
// Section: Pure view helpers (no computation of science: only selection/aggregation of backend outputs)
// ─────────────────────────────────────────

export interface ZoneView {
  zone: ZoneResult;
  state: TwinState | null;
  baselineState: TwinState | null;
  baselineStates: TwinState[];
  ndvi: ObservationPoint | null;
  ndviSource: ObservationSeries | null;
  cumulativeIrrigation: number;
}

export function activeRun(baseline: TwinSimulateResponse | null, scenario: TwinSimulateResponse | null) {
  return scenario ?? baseline;
}

export function datesOf(run: TwinSimulateResponse | null): string[] {
  return run?.zones[0]?.states.map((s) => s.date) ?? [];
}

// Latest observation on or before `date` for a zone; prefers the finer source when it is at least as recent
export function observedNdvi(
  zoneId: string,
  date: string,
  sources: (ObservationSeries | null)[],
): { point: ObservationPoint; series: ObservationSeries } | null {
  let best: { point: ObservationPoint; series: ObservationSeries } | null = null;
  for (const series of sources) {
    if (!series) continue;
    for (const p of series.points) {
      if (p.zone_id !== zoneId || p.date > date) continue;
      if (!best || p.date > best.point.date || (p.date === best.point.date && series.resolution_m < best.series.resolution_m)) {
        best = { point: p, series };
      }
    }
  }
  return best;
}

export function zoneViews(
  baseline: TwinSimulateResponse | null,
  scenario: TwinSimulateResponse | null,
  dayIndex: number,
  ndviSources: (ObservationSeries | null)[],
): ZoneView[] {
  const run = activeRun(baseline, scenario);
  if (!run) return [];
  return run.zones.map((zone) => {
    const state = zone.states[dayIndex] ?? null;
    const baseStates = baseline?.zones.find((z) => z.zone_id === zone.zone_id)?.states ?? [];
    const base = baseStates[dayIndex] ?? null;
    const obs = state ? observedNdvi(zone.zone_id, state.date, ndviSources) : null;
    let irr = 0;
    for (let i = 0; i <= dayIndex && i < zone.states.length; i += 1) irr += zone.states[i]?.irrigation_mm ?? 0;
    return {
      zone,
      state,
      baselineState: base,
      baselineStates: baseStates,
      ndvi: obs?.point ?? null,
      ndviSource: obs?.series ?? null,
      cumulativeIrrigation: irr,
    };
  });
}

export function layerRamp(layer: Layer): RampStop[] {
  switch (layer) {
    case "ndvi":
      return NDVI_RAMP;
    case "stress":
      return STRESS_RAMP;
    case "moisture":
      return MOISTURE_RAMP;
    case "temperature":
      return TEMPERATURE_RAMP;
    case "irrigation":
      return IRRIGATION_RAMP;
  }
}

export function layerValue(view: ZoneView, layer: Layer): number | null {
  const s = view.state;
  switch (layer) {
    case "ndvi":
      return view.ndvi?.value ?? null;
    case "stress":
      return s ? s.ks : null;
    case "moisture":
      return s ? s.soil_water_fraction : null;
    case "temperature":
      return s ? s.t_max : null;
    case "irrigation":
      return view.cumulativeIrrigation;
  }
}

export function layerState(view: ZoneView, layer: Layer): DataState | null {
  if (layer === "ndvi") return view.ndviSource?.provenance.data_state ?? null;
  if (layer === "temperature") {
    // Temperature is the observed series unless the scenario shifted it
    if (!view.state) return null;
    return view.state.data_state === "SIMULATED" ? "SIMULATED" : view.state.data_state === "SYNTHETIC" ? "SYNTHETIC" : "MEASURED";
  }
  return view.state?.data_state ?? null;
}

export function layerColor(view: ZoneView, layer: Layer): string {
  const v = layerValue(view, layer);
  // Negative NDVI = water / masked pixels: the canonical no-data grey, never a vigor colour
  if (layer === "ndvi" && (v === null || v < 0)) return NDVI_NODATA;
  return rampColor(layerRamp(layer), v);
}

export function layerLabel(view: ZoneView, layer: Layer): string {
  const v = layerValue(view, layer);
  if (v === null) return "—";
  switch (layer) {
    case "ndvi":
      return v.toFixed(2);
    case "stress":
      return `Ks ${v.toFixed(2)}`;
    case "moisture":
      return `${Math.round(v * 100)} %`;
    case "temperature":
      return `${v.toFixed(1)} °C`;
    case "irrigation":
      return `${Math.round(v)} mm`;
  }
}

// Canopy height factor 0..1 from the expected canopy curve of the zone (drives plant height in the diorama)
export function canopyFactor(zone: ZoneResult, date: string | undefined): number {
  if (!date) return 0;
  const point = zone.expected_canopy.find((p) => p.date === date);
  return point ? point.value : 0;
}

export function cumulative(states: TwinState[], upTo: number, key: "precip_mm" | "irrigation_mm"): number {
  let total = 0;
  for (let i = 0; i <= upTo && i < states.length; i += 1) total += states[i]?.[key] ?? 0;
  return total;
}

// Class of a daily Ks with the thresholds served by /api/twin/config (product configuration, not science)
export function stressClassFor(ks: number, thresholds: { min_ks: number; class: StressClass }[]): StressClass {
  const sorted = [...thresholds].sort((a, b) => b.min_ks - a.min_ks);
  return sorted.find((t) => ks >= t.min_ks)?.class ?? "HIGH";
}
