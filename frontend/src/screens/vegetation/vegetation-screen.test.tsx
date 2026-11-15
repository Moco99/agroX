import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FarmAnalyzeResponse, ObservationSeries } from "../../types/api";
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
});
