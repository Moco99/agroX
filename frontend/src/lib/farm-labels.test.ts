import { describe, expect, it } from "vitest";
import type { ClimateResponse, FarmAnalyzeResponse } from "../types/api";
import { cropLabel, fallbackNote, ndviMissingText, parcelSources } from "./farm-labels";

const farm = {
  farm: {
    provenance: {
      terrain: { source: "Copernicus DEM GLO-30 (Planetary Computer)", data_state: "MEASURED" },
      soil: { source: "SoilGrids 2.0 (ISRIC) wv0033 - wv1500, 0-100 cm", data_state: "ESTIMATED" },
    },
  },
  latest_ndvi_source: null,
} as unknown as FarmAnalyzeResponse;
const climate = { series: { provenance: { source: "NASA POWER", data_state: "MEASURED" } } } as unknown as ClimateResponse;

describe("farm labels", () => {
  it("lists only the sources a drawn parcel used", () => {
    expect(parcelSources(farm, climate, null)).toEqual(["NASA POWER", "Copernicus DEM GLO-30", "SoilGrids 2.0", "Esri World Imagery"]);
  });

  it("shows the 3D fallback note only when a fallback is in use", () => {
    expect(fallbackNote("ready", true, true)).toBeNull();
    expect(fallbackNote("loading", false, false)).toBeNull();
    expect(fallbackNote("failed", true, true)).toContain("imagen");
    expect(fallbackNote("ready", false, true)).toContain("relieve");
    expect(fallbackNote("failed", false, true)).toContain("terreno plano");
  });

  it("distinguishes downloading NDVI from no scenes", () => {
    expect(ndviMissingText("running")).toBe("descargando…");
    expect(ndviMissingText("ready")).toBe("sin escenas");
  });

  it("flags an undeclared crop as an estimated assumption", () => {
    expect(cropLabel("corn", false)).toEqual({ text: "Maíz (supuesto, sin declarar)", state: "ESTIMATED" });
    expect(cropLabel("corn", true).state).toBe("DECLARED");
  });
});
