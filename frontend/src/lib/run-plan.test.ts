import { describe, expect, it } from "vitest";
import { EMPTY_DECLARATION } from "./parcel";
import { buildRunPlan } from "./run-plan";
import type { CropCatalogLite } from "../types/parcel";

const CATALOG: CropCatalogLite = {
  catalog_version: "test",
  notes: [],
  crops: [
    { crop_id: "maize", name_es: "Maíz", name_en: "Maize", cycle_days: 130, crop_type: "annual", planting_window: { start_mmdd: "05-01", end_mmdd: "05-20" } },
    { crop_id: "soy", name_es: "Soya", name_en: "Soy", cycle_days: 120, crop_type: "annual", planting_window: { start_mmdd: "05-10", end_mmdd: "06-05" } },
  ],
};
const ZONES = [
  { zone_id: "z1", crop_id: "maize" },
  { zone_id: "z2", crop_id: "maize" },
];

describe("buildRunPlan", () => {
  it("suggests a planting date per crop and no overrides when nothing is declared", () => {
    const plan = buildRunPlan({ zones: ZONES, lat: 18.8, declaration: EMPTY_DECLARATION, catalog: CATALOG, coverageEnd: "2026-11-01" });
    expect(plan.plantingDates.maize).toBe("2026-05-01");
    expect(plan.cropOverrides).toEqual({});
    expect(plan.declaredPlanting).toEqual([]);
    expect(plan.span.end <= "2026-11-01").toBe(true);
  });

  it("shifts the suggestion six months in the southern hemisphere", () => {
    const plan = buildRunPlan({ zones: ZONES, lat: -33.9, declaration: EMPTY_DECLARATION, catalog: CATALOG, coverageEnd: "2026-11-01" });
    expect(plan.plantingDates.maize?.slice(5)).toBe("11-01");
  });

  it("keeps declared crops and dates and only overrides zones that differ", () => {
    const plan = buildRunPlan({
      zones: ZONES,
      lat: 30.8,
      declaration: { crops: { z2: "soy" }, planting: { soy: "2026-06-01" } },
      catalog: CATALOG,
      coverageEnd: "2026-11-01",
    });
    expect(plan.cropOverrides).toEqual({ z2: "soy" });
    expect(plan.plantingDates.soy).toBe("2026-06-01");
    expect(plan.declaredPlanting).toEqual(["soy"]);
    expect(plan.span.start).toBe("2026-04-01");
  });

  it("lets a southern season cross New Year", () => {
    const plan = buildRunPlan({ zones: ZONES, lat: -33.9, declaration: EMPTY_DECLARATION, catalog: CATALOG, coverageEnd: "2026-11-01" });
    expect(plan.span.end > plan.span.start).toBe(true);
    expect(plan.span.end.slice(0, 4) > plan.span.start.slice(0, 4)).toBe(true);
  });

  it("prefers the backend suggestion over the client estimate, and a declaration over both", () => {
    const base = { zones: ZONES, lat: -33.9, catalog: CATALOG, coverageEnd: "2026-11-01", suggestedSeason: { start: "2025-09-15", end: "2026-04-30" }, suggestedPlanting: { maize: "2025-10-20" } };
    const a = buildRunPlan({ ...base, declaration: EMPTY_DECLARATION });
    expect(a.plantingDates.maize).toBe("2025-10-20");
    expect(a.span).toEqual({ start: "2025-09-15", end: "2026-04-30" });
    const b = buildRunPlan({ ...base, declaration: { crops: {}, planting: { maize: "2025-11-10" } } });
    expect(b.plantingDates.maize).toBe("2025-11-10");
    expect(b.declaredPlanting).toEqual(["maize"]);
  });

  it("falls back to a window ending at coverage when the catalog is missing", () => {
    const plan = buildRunPlan({ zones: ZONES, lat: 0, declaration: EMPTY_DECLARATION, catalog: null, coverageEnd: "2026-11-01" });
    expect(plan.span.end).toBe("2026-11-01");
    expect(plan.plantingDates).toEqual({});
  });
});
