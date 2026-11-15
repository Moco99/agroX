import { describe, expect, it } from "vitest";
import { periodError, rotationPresets, splitPeriod, windowsError } from "./rotation-dates";

describe("rotation dates", () => {
  it("builds the three presets, each a valid period", () => {
    const presets = rotationPresets(2024, "2026-11-15");
    expect(presets.map((p) => p.label)).toEqual(["Temporada primavera-verano", "Otoño-invierno", "Último año"]);
    expect(presets[1]?.range.end).toBe("2025-03-20");
    expect(presets[2]?.range).toEqual({ start: "2025-11-16", end: "2026-11-15" });
    for (const p of presets) expect(periodError(p.range.start, p.range.end)).toBeNull();
  });

  it("reports es-MX range errors", () => {
    expect(periodError("", "2024-01-01")).toBe("Elige la fecha inicial y la final.");
    expect(periodError("2024-05-01", "2024-04-01")).toMatch(/igual o posterior/);
    expect(periodError("2020-01-01", "2024-01-01")).toMatch(/hasta 731 días/);
    expect(periodError("2024-04-01", "2024-10-31")).toBeNull();
  });

  it("splits a period into ordered windows that validate", () => {
    const w = splitPeriod("2024-01-01", "2024-12-31", 3);
    expect(w).toHaveLength(3);
    expect(w[0]?.start).toBe("2024-01-01");
    expect(w[2]?.end).toBe("2024-12-31");
    expect(windowsError(w)).toBeNull();
  });

  it("flags overlapping or incomplete windows", () => {
    expect(windowsError([{ start: "2024-01-01", end: "2024-03-01" }, { start: "2024-02-01", end: "2024-06-01" }])).toMatch(/ciclo 2 debe empezar/);
    expect(windowsError([{ start: "", end: "" }])).toBe("Completa las fechas del ciclo 1.");
  });
});
