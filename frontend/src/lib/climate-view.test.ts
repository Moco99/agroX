import { describe, expect, it } from "vitest";
import { anomalyExplanation, metricOf, spiExplanation, spiLabel, windowDays, windowError } from "./climate-view";

describe("climate-view", () => {
  it("validates the 800-day window", () => {
    expect(windowDays("2024-01-01", "2024-01-01")).toBe(1);
    expect(windowError("2024-01-01", "2026-03-10")).toBeNull();
    expect(windowError("2020-01-01", "2024-01-01")).toMatch(/800/);
    expect(windowError("2024-02-01", "2024-01-01")).not.toBeNull();
    expect(windowError("", "2024-01-01")).not.toBeNull();
  });

  it("keeps only well-formed metrics", () => {
    const ind = { a: { value: 3, unit: "mm", data_state: "MEASURED", source: "POWER" }, b: { value: null, unit: "x", data_state: "ESTIMATED" }, c: { value: 1, unit: "x", data_state: "BOGUS" }, d: 5 };
    expect(metricOf(ind, "a")).toEqual({ value: 3, unit: "mm", data_state: "MEASURED", source: "POWER" });
    expect(metricOf(ind, "b")?.value).toBeNull();
    expect(metricOf(ind, "c")).toBeNull();
    expect(metricOf(ind, "d")).toBeNull();
    expect(metricOf(ind, "zz")).toBeNull();
  });

  it("explains SPI and anomaly in plain language, withholding missing values", () => {
    expect(spiLabel(-1.7)).toBe("muy seco");
    expect(spiLabel(0.2)).toBe("cercano a lo normal");
    expect(spiExplanation(null)).toMatch(/no se estima/);
    expect(spiExplanation(1.2)).toMatch(/moderadamente húmedo/);
    expect(anomalyExplanation(null)).toMatch(/10 años/);
    expect(anomalyExplanation(-12.34)).toMatch(/12\.3 % menos/);
  });
});
