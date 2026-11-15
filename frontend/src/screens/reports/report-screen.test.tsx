import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClimateResponse, FarmAnalyzeResponse } from "../../types/api";
import { ReportView } from "./report-screen";

const prov = { source: "NASA POWER", data_state: "MEASURED" as const };
const farm = {
  farm: {
    farm_id: "f", name: "Parcela X", area_ha: 12.5,
    zones: [{
      zone_id: "z1", name: "Zona 1", area_ha: 6, data_state: "ESTIMATED",
      soil: { texture: "franco", awc_mm_per_m: 150, provenance: { source: "SSURGO", data_state: "MEASURED" } },
      terrain: { elevation_mean_m: 300, slope_mean_pct: 2, data_state: "MEASURED" },
    }],
  },
  latest_ndvi: { z1: 0.62 }, latest_ndvi_date: "2024-07-01", latest_ndvi_source: "Sentinel-2",
} as unknown as FarmAnalyzeResponse;
const climate = {
  methodology: "m",
  series: { days: [{ date: "2024-04-01" }, { date: "2024-04-02" }], provenance: prov },
  indicators: { precip_total: { value: 100, unit: "mm", data_state: "MEASURED", source: "POWER" } },
} as unknown as ClimateResponse;

describe("ReportView", () => {
  it("renders every section with sources and the exploratory disclaimer", () => {
    const html = renderToStaticMarkup(<ReportView farm={farm} climate={climate} twin={null} rotation={null} />);
    expect(html).toContain("Parcela X");
    expect(html).toContain("Zona 1");
    expect(html).toContain("SSURGO");
    expect(html).toContain("Sentinel-2");
    expect(html).toMatch(/0[.,]62/);
    expect(html).toContain("NASA POWER");
    expect(html).toContain("no es una predicción de rendimiento");
    expect(html).toContain("Aún no hay simulación");
    expect(html).toContain("Aún no se ha calculado una comparación de rotaciones");
  });

  it("names the climate window and flags the assumed crop", () => {
    const f = { ...farm, farm: { ...farm.farm, zones: [{ ...farm.farm.zones[0], crop_id: "corn" }] } } as unknown as FarmAnalyzeResponse;
    const html = renderToStaticMarkup(<ReportView farm={f} climate={climate} climateFrom="clima" twin={null} rotation={null} />);
    expect(html).toContain("Ventana del módulo Clima");
    expect(html).toContain("Maíz (supuesto, sin declarar)");
    expect(renderToStaticMarkup(<ReportView farm={f} climate={climate} twin={null} rotation={null} />)).toContain("Ventana del gemelo");
  });

  it("tells the reader how to read the report and spells every verdict", () => {
    const twin = {
      start: "2024-05-01", end: "2024-09-30", twin_level: "DIGITAL_SHADOW", methodology: "twin_v1",
      farm_summary: { mean_ks_area_weighted: 0.9, stress_class: "LOW", total_precip_mm: 400, total_irrigation_mm: 0 },
      zones: [],
    } as unknown as Parameters<typeof ReportView>[0]["twin"];
    const html = renderToStaticMarkup(<ReportView farm={farm} climate={climate} twin={twin} rotation={null} />);
    expect(html).toContain("Cómo leer este informe");
    expect(html).toContain("modelos de proceso públicos");
    expect(html).toContain("Sombra digital");
    expect(html).not.toContain(">DIGITAL_SHADOW<");
    expect(html).toContain("estrés leve");
    expect(html).toContain("Gemelo v1");
    expect(html).toContain("vegetación densa");
  });

  it("separates the simulated period, the run time, the reference year and the NDVI date", () => {
    const twin = {
      start: "2026-11-15", end: "2027-11-15", twin_level: "DIGITAL_MODEL", methodology: "twin_v1",
      computed_at: "2026-11-15T18:30:00Z",
      farm_summary: { mean_ks_area_weighted: 0.9, stress_class: "LOW", total_precip_mm: 400, total_irrigation_mm: 0 },
      zones: [{ zone_id: "z1", name: "Zona 1", outcome: {
        status: "NOT_MATURE", planted_in_window: true, reached_maturity: false, maturity_date: null, gdd_accumulated: 900,
        gdd_required: 1500, stress_days: 0, stress_day_ks: 0.8, frost_days: 0, data_state: "SIMULATED", note: "",
      } }],
    } as unknown as Parameters<typeof ReportView>[0]["twin"];
    const html = renderToStaticMarkup(<ReportView farm={farm} climate={climate} twin={twin} rotation={null} referenceYear={2024} />);
    expect(html).toContain("Simulación del gemelo");
    expect(html).not.toContain("Última simulación");
    expect(html).toContain("Periodo simulado");
    expect(html).toContain("referencia: 2024");
    expect(html).toContain("Calculada el");
    expect(html).toContain("Resultado de la temporada");
    expect(html).toContain("No alcanzó la madurez");
    expect(html).toContain("no es una predicción de rendimiento");
    expect(html).toContain("independiente del periodo simulado");
  });

  it("degrades to empty-state messages without data", () => {
    const html = renderToStaticMarkup(<ReportView farm={null} climate={null} twin={null} rotation={null} />);
    expect(html).toContain("Sin datos climáticos");
    expect(html).toContain("Sin NDVI observado");
  });
});
