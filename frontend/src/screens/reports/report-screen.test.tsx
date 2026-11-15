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

  it("degrades to empty-state messages without data", () => {
    const html = renderToStaticMarkup(<ReportView farm={null} climate={null} twin={null} rotation={null} />);
    expect(html).toContain("Sin datos climáticos");
    expect(html).toContain("Sin NDVI observado");
  });
});
