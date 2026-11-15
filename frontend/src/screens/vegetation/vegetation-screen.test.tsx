import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FarmAnalyzeResponse, ObservationSeries } from "../../types/api";
import { downsample } from "../../lib/vegetation";
import VegetationScreen from "./vegetation-screen";

// SSR reads zustand's initial state, so the store is replaced by a plain selector over a fixed state
const state: Record<string, unknown> = {};
vi.mock("../../store/twin-store", () => ({ useTwinStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state) }));

const pt = (date: string, value: number) => ({ date, value, variable: "ndvi", zone_id: "z1", n_pixels: 4, qa_flag: null, valid_fraction: 0.9 });

describe("VegetationScreen", () => {
  it("shows zones, ESTIMATED events, the comparison verdict and warnings", () => {
    const sentinel2 = {
      variable: "ndvi", source_id: "sentinel2", resolution_m: 10, warnings: ["aviso de nubes"],
      provenance: { source: "Sentinel-2 L2A", data_state: "MEASURED" },
      points: [pt("2023-07-10", 0.8), pt("2024-03-01", 0.1), pt("2024-05-01", 0.3), pt("2024-06-01", 0.7), pt("2024-07-11", 0.5)],
    } as unknown as ObservationSeries;
    const farm = { farm: { name: "Parcela X", zones: [{ zone_id: "z1", name: "Zona 1" }] } } as unknown as FarmAnalyzeResponse;
    Object.assign(state, { farm, sentinel2, modis: null, selectedZoneId: "z1", selectZone: () => undefined });
    const html = renderToStaticMarkup(<VegetationScreen />);
    expect(html).toContain("Zona 1");
    expect(html).toContain("Estimado");
    expect(html).toContain("por debajo de lo usual");
    expect(html).toContain("parámetros de producto");
    expect(html).toContain("aviso de nubes");
  });

  it("renders a large multi-zone multi-year series within a time budget and caps chart lines", () => {
    const zones = Array.from({ length: 20 }, (_, i) => ({ zone_id: `z${i}`, name: `Zona ${i}` }));
    const points = zones.flatMap((z) => Array.from({ length: 1500 }, (_, d) => {
      const date = new Date(Date.UTC(2020, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      return { ...pt(date, 0.5 + 0.3 * Math.sin(d / 58)), zone_id: z.zone_id };
    }));
    const sentinel2 = { variable: "ndvi", source_id: "sentinel2", resolution_m: 10, warnings: [], provenance: { source: "S2", data_state: "MEASURED" }, points } as unknown as ObservationSeries;
    const farm = { farm: { name: "Grande", zones } } as unknown as FarmAnalyzeResponse;
    Object.assign(state, { farm, sentinel2, modis: null, selectedZoneId: "z0", selectZone: () => undefined });
    const t0 = performance.now();
    renderToStaticMarkup(<VegetationScreen />);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(downsample(points, 200)).toHaveLength(200);
  });

  it("says NDVI is downloading while its stage is pending", () => {
    const farm = { farm: { name: "P", zones: [] }, load_status: { stages: [{ stage: "ndvi", status: "pending" }] } } as unknown as FarmAnalyzeResponse;
    Object.assign(state, { farm, sentinel2: null, modis: null, selectedZoneId: null });
    expect(renderToStaticMarkup(<VegetationScreen />)).toContain("Descargando NDVI");
  });
});
