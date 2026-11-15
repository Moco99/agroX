import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClimateProjectionInfo, TwinSimulateResponse } from "../../types/api";
import { ProjectionData } from "./projection-data";
import { SeasonOutcomeList } from "./season-outcome";

const info: ClimateProjectionInfo = {
  source: "NASA POWER Climate Projection API (NEX-GDDP-CMIP6)",
  scenario: "ssp245",
  models_requested: ["ec_earth3", "gfdl_esm4", "ipsl_cm6a_lr", "mpi_esm1_2_lr"],
  models_used: ["ec_earth3", "gfdl_esm4", "ipsl_cm6a_lr"],
  models_failed: { mpi_esm1_2_lr: "TimeoutError" },
  animated_model: "ec_earth3",
  animated_rule: "Se anima el modelo con la lluvia mediana del periodo.",
  variables: ["PRECTOTCORR: precipitación (mm/día)"],
  conversions: ["Viento: de 10 m a 2 m con FAO-56 ec. 47 (× 0.748)."],
  filled_days: { ec_earth3: ["2026-12-20..2026-12-31"] },
  api_first_day: "2015-01-01",
  api_last_day: "2100-12-31",
  data_state: "SIMULATED",
};

describe("projection data block", () => {
  it("lists source, models, scenario, conversions, filled days and the SIMULATED badge", () => {
    const html = renderToStaticMarkup(<ProjectionData info={info} />);
    expect(html).toContain("Datos que usa esta simulación");
    expect(html).toContain("NEX-GDDP-CMIP6");
    expect(html).toContain("Emisiones medias (SSP2-4.5)");
    expect(html).toContain("ec_earth3, gfdl_esm4, ipsl_cm6a_lr");
    expect(html).toContain("mpi_esm1_2_lr");
    expect(html).toContain("FAO-56 ec. 47");
    expect(html).toContain("2026-12-20..2026-12-31");
    expect(html).toContain("Simulado");
  });

  it("shows the across-model range in the season outcome", () => {
    const run = {
      data_mode: "live",
      climate_projection: info,
      zones: [{
        zone_id: "z1", name: "Zona 1", data_state: "SIMULATED",
        outcome: { status: "COMPLETED", planted_in_window: true, reached_maturity: true, maturity_date: "2027-08-18", gdd_accumulated: 1500, gdd_required: 1500, stress_days: 17, stress_day_ks: 0.8, frost_days: 0, data_state: "SIMULATED", note: "" },
        projection_range: { n_models: 3, matured_models: 3, stress_days_min: 7, stress_days_max: 35, season_precip_min_mm: 858, season_precip_max_mm: 950, by_model: [], data_state: "SIMULATED", note: "" },
      }],
    } as unknown as TwinSimulateResponse;
    const html = renderToStaticMarkup(<SeasonOutcomeList run={run} />);
    expect(html).toContain("Entre 3 modelo(s) climático(s): maduró en 3 de 3; días de estrés 7–35");
    expect(html).toContain("no es una probabilidad");
  });
});

describe("data-origin legend", () => {
  it("names the projection source when the run used one", async () => {
    const { DataStateLegend } = await import("../../components/explain/data-state-legend");
    const html = renderToStaticMarkup(<DataStateLegend sources={["Clima simulado: NASA POWER proyección CMIP6 (NEX-GDDP), Emisiones altas (SSP3-7.0)"]} />);
    expect(html).toContain("¿De dónde sale cada dato?");
    expect(html).toContain("NASA POWER proyección CMIP6");
  });
});
