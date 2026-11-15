import { describe, expect, it } from "vitest";
import { referenceOptions } from "./weather-coverage";

describe("referenceOptions", () => {
  it("lists the partial current year first, then complete years newest first", () => {
    const options = referenceOptions({ start: "1981-01-01", end: "2026-11-10", available_days: 1, missing: [], complete_years: [2024, 2025] });
    expect(options).toEqual([{ year: 2026, complete: false }, { year: 2025, complete: true }, { year: 2024, complete: true }]);
  });
  it("does not duplicate a complete last year", () => {
    expect(referenceOptions({ start: "2023-01-01", end: "2024-12-31", available_days: 1, missing: [], complete_years: [2023, 2024] })).toHaveLength(2);
  });
});
