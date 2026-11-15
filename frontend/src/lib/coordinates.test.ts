import { describe, expect, it } from "vitest";
import { coordinatesView, sameQueriedPoint } from "./coordinates";

describe("coordinatesView", () => {
  it("uses longitude then latitude and frames ordinary locations at field scale", () => {
    expect(coordinatesView("19.4326", "-99.1332")).toEqual({ center: [-99.1332, 19.4326], zoom: 14, bearing: 0, pitch: 0 });
  });
  it("keeps polar coordinates on the globe", () => {
    expect(coordinatesView("90", "180")?.zoom).toBe(2);
    expect(coordinatesView("-90", "-180")?.center).toEqual([-180, -90]);
  });
  it.each([["", "0"], ["0", " "], ["91", "0"], ["0", "181"], ["NaN", "0"]])("rejects invalid coordinates", (lat, lon) => {
    expect(coordinatesView(lat, lon)).toBeNull();
  });
});

it("matches the exact sampled point instead of a nearby field", () => {
  expect(sameQueriedPoint({ lat: 19.12345, lon: -99.12345 }, { lat: 19.123451, lon: -99.123451 })).toBe(true);
  expect(sameQueriedPoint({ lat: 19.12345, lon: -99.12345 }, { lat: 19.12445, lon: -99.12345 })).toBe(false);
});
