import { describe, expect, it } from "vitest";
import type { ObservationPoint } from "../types/api";
import { analyzeSeason, clearPoints, compareWithPreviousYears, verdictText } from "./vegetation";

const pt = (date: string, value: number, valid?: number): ObservationPoint => ({
  date, value, variable: "ndvi", zone_id: "z", n_pixels: null, qa_flag: null, valid_fraction: valid ?? null,
});

describe("vegetation", () => {
  it("filters clouded observations only when the share is reported", () => {
    expect(clearPoints([pt("2024-05-01", 0.5, 0.2), pt("2024-05-02", 0.5, 0.9), pt("2024-05-03", 0.5)])).toHaveLength(2);
  });

  it("finds green-up, peak, senescence and bare-soil periods", () => {
    const s = analyzeSeason(
      [pt("2024-03-01", 0.1), pt("2024-04-01", 0.15), pt("2024-05-01", 0.3), pt("2024-06-01", 0.7), pt("2024-07-15", 0.9), pt("2024-09-01", 0.5), pt("2024-10-01", 0.2)],
      2024,
    );
    expect(s.events.map((e) => e.kind)).toEqual(["green_up", "peak", "senescence"]);
    expect(s.events[1]?.date).toBe("2024-07-15");
    expect(s.bareSoil).toEqual([
      { start: "2024-03-01", end: "2024-04-01", observations: 2 },
      { start: "2024-10-01", end: "2024-10-01", observations: 1 },
    ]);
  });

  it("declines to find a cycle with flat or sparse data", () => {
    const flat = analyzeSeason([pt("2024-05-01", 0.5), pt("2024-06-01", 0.52), pt("2024-07-01", 0.55)], 2024);
    expect(flat.events.map((e) => e.kind)).toEqual(["peak"]);
    expect(analyzeSeason([pt("2024-05-01", 0.5)], 2024).events).toEqual([]);
  });

  it("compares the latest value with earlier years around the same date", () => {
    const c = compareWithPreviousYears([pt("2023-07-10", 0.6), pt("2022-07-12", 0.7), pt("2024-07-11", 0.4)]);
    expect(c?.verdict).toBe("below");
    expect(c?.mean).toBeCloseTo(0.65);
    expect(verdictText(c)).toContain("por debajo de lo usual");
    expect(compareWithPreviousYears([pt("2024-07-11", 0.4)])?.verdict).toBe("no_history");
  });
});
