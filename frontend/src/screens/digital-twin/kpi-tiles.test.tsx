import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ZoneView } from "../../lib/derive";
import { explain } from "../../lib/explain";
import type { TwinConfig, TwinSimulateResponse, TwinState, ZoneResult } from "../../types/api";
import { KpiTiles } from "./kpi-tiles";

// TAW 200 mm, RAW 100 mm (p = 0.5): 76 mm depleted leaves 62 % -> within RAW, no stress
const state = (over: Partial<TwinState> = {}): TwinState => ({
  date: "2024-07-01", crop_id: "corn", stage: "MID_SEASON", gdd_day: 12, gdd_cum: 900, kc: 1.1, root_depth_m: 1,
  taw_mm: 200, raw_mm: 100, root_zone_depletion_mm: 76, soil_water_fraction: 0.62, ks: 1,
  et0_mm: 5, etc_mm: 5.5, etc_adj_mm: 5.5, precip_mm: 10, effective_precip_mm: 10, runoff_mm: 0,
  irrigation_mm: 0, drainage_mm: 0, t_max: 30, t_min: 18, data_state: "ESTIMATED", ...over,
});

const config = {
  stress_class_thresholds_mean_ks: [
    { min_ks: 0.95, class: "NONE" },
    { min_ks: 0.8, class: "LOW" },
    { min_ks: 0.6, class: "MEDIUM" },
  ],
  stress_day_ks: 0.8,
} as unknown as TwinConfig;

function viewOf(s: TwinState): ZoneView {
  const zone = { zone_id: "z1", name: "Zona Norte", states: [s] } as unknown as ZoneResult;
  return { zone, state: s, baselineState: s, baselineStates: [s], ndvi: null, ndviSource: null, cumulativeIrrigation: 0 };
}

describe("KpiTiles", () => {
  it("reads soil water in plain words with its unit, verdict and formula", () => {
    const html = renderToStaticMarkup(<KpiTiles view={viewOf(state())} hasScenario={false} config={config} />);
    expect(html).toContain("Agua disponible");
    expect(html).toContain("62");
    expect(html).toContain("% del agua útil del suelo (TAW)");
    expect(html).toContain("suficiente");
    expect(html).toContain("sin estrés");
    expect(html).toContain("¿Cómo se calcula?");
    expect(html).toContain("(200 − 76) ÷ 200 = 62 %");
    expect(html).toContain("sin observación");
  });

  it("flags insufficient water when depletion goes past RAW with high stress", () => {
    const dry = state({ root_zone_depletion_mm: 190, soil_water_fraction: 0.05, ks: 0.1 });
    const html = renderToStaticMarkup(<KpiTiles view={viewOf(dry)} hasScenario={false} config={config} />);
    expect(html).toContain("insuficiente");
    expect(html).toContain("estrés alto");
    expect(html).toContain("tone-bad");
  });
});

describe("explain (template text)", () => {
  const zone = {
    zone_id: "z1", name: "Zona Norte", crop_id: "corn", area_ha: 9, irrigation_level: "NONE", comparison: [],
    summary: {
      mean_ks: 0.7, stress_days: 12, stress_class: "MEDIUM", min_soil_water_fraction: 0.2,
      total_precip_mm: 300, total_et0_mm: 500, total_irrigation_mm: 0,
      stage_dates: { planting: null, development: null, mid_season: null, late_season: null, maturity: null },
    },
  } as unknown as ZoneResult;
  const run = { start: "2024-05-01", end: "2024-09-30", zones: [zone] } as unknown as TwinSimulateResponse;

  it("explains the season in plain language with the backend stress-day threshold", () => {
    const { paragraphs, suggestion } = explain(run, null, null, 0.8);
    const text = paragraphs.join(" ");
    expect(text).toContain("llovieron 300 mm");
    expect(text).toContain("la lluvia fue menor que esa demanda de referencia");
    expect(text).not.toContain("el cultivo dependió");
    expect(text).toContain("faltó agua en varios momentos (estrés moderado)");
    expect(text).toMatch(/12 días con estrés hídrico \(Ks menor a 0[.,]80\)/);
    expect(suggestion).toContain("prueba un nivel de riego");
  });

  it("omits the threshold when the config is not loaded", () => {
    const text = explain(run, null, null).paragraphs.join(" ");
    expect(text).toContain("12 días con estrés hídrico y");
  });
});
