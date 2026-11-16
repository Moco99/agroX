import { describe, expect, it } from "vitest";
import { climateFields, projectionWindowError, rangeText, scenarioLabel } from "./climate-projection";
import type { ProjectionRange } from "../types/api";

const range = (over: Partial<ProjectionRange> = {}): ProjectionRange => ({
  n_models: 4, matured_models: 3, stress_days_min: 7, stress_days_max: 35,
  season_precip_min_mm: 858.2, season_precip_max_mm: 950.1, by_model: [], data_state: "SIMULATED", note: "", ...over,
});

describe("climateFields", () => {
  it("keeps the historical request untouched without a projection", () => {
    expect(climateFields(2024, null)).toEqual({ reference_year: 2024 });
    expect(climateFields(null, null)).toEqual({ reference_year: null });
  });
  it("sends only the projection, never mixed with a reference year", () => {
    expect(climateFields(2024, { scenario: "ssp370" })).toEqual({
      reference_year: null, climate_source: "projection", projection: { scenario: "ssp370" },
    });
  });
});

describe("projection labels and limits", () => {
  it("labels scenarios in plain words with the SSP code", () => {
    expect(scenarioLabel("ssp126")).toBe("Emisiones bajas (SSP1-2.6)");
    expect(scenarioLabel("ssp245")).toContain("medias");
    expect(scenarioLabel("ssp370")).toContain("SSP3-7.0");
  });
  it("rejects windows outside 2015-2100", () => {
    expect(projectionWindowError("2026-11-01", "2027-11-01")).toBeNull();
    expect(projectionWindowError("2014-12-01", "2015-05-01")).not.toBeNull();
    expect(projectionWindowError("2100-06-01", "2101-01-31")).not.toBeNull();
  });
  it("describes the spread across models", () => {
    expect(rangeText(range())).toBe("Entre 4 modelo(s) climático(s): maduró en 3 de 4; días de estrés 7–35; lluvia del periodo 858–950 mm.");
    expect(rangeText(range({ stress_days_min: 0, stress_days_max: 0 }))).toContain("días de estrés 0;");
    expect(rangeText(range({ n_models: 1 }))).toContain("Solo se usó un modelo");
  });
});
