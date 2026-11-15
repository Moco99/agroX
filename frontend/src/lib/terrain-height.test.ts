import { describe, expect, it } from "vitest";
import { footprintBaseM, sampleHeightM } from "./terrain-height";

// 2x2 grid, north row 110/120 m, south row 100/130 m; min 100
const hm = {
  bounds: { west: 0, east: 1, south: 0, north: 1 },
  width: 2,
  height: 2,
  elevations_m: [110, 120, 100, 130],
  min_m: 100,
};

describe("terrain height sampling", () => {
  it("reads the corners with row 0 at the north edge", () => {
    expect(sampleHeightM(hm, 0, 1)).toBe(10);
    expect(sampleHeightM(hm, 1, 1)).toBe(20);
    expect(sampleHeightM(hm, 0, 0)).toBe(0);
    expect(sampleHeightM(hm, 1, 0)).toBe(30);
  });
  it("interpolates and clamps outside the grid", () => {
    expect(sampleHeightM(hm, 0.5, 1)).toBe(15);
    expect(sampleHeightM(hm, 5, 5)).toBe(20);
  });
  it("bases a footprint on its lowest point", () => {
    expect(footprintBaseM(hm, [[0.9, 0.9], [1, 0.9], [1, 1]])).toBeCloseTo(sampleHeightM(hm, 0.9, 0.9));
    expect(footprintBaseM(hm, [])).toBe(0);
  });
});
