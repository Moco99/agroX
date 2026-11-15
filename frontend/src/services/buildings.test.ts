import { describe, expect, it } from "vitest";
import { buildingHeight, parseOverpassBuildings } from "./buildings";

const sq = [
  { lat: 1, lon: 1 },
  { lat: 1, lon: 2 },
  { lat: 2, lon: 2 },
  { lat: 1, lon: 1 },
];

describe("overpass building parser", () => {
  it("derives height from height, levels or the default", () => {
    expect(buildingHeight({ height: "12.5 m" })).toBe(12.5);
    expect(buildingHeight({ "building:levels": "3" })).toBe(9);
    expect(buildingHeight({})).toBe(6);
  });
  it("parses closed rings and skips malformed elements", () => {
    const out = parseOverpassBuildings({
      elements: [
        { type: "way", tags: { building: "yes", "building:levels": "2" }, geometry: sq },
        { type: "way", tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }] },
        { type: "way", geometry: sq },
        null,
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.ring).toHaveLength(3);
    expect(out[0]?.height_m).toBe(6);
  });
  it("returns nothing for garbage", () => {
    expect(parseOverpassBuildings(null)).toEqual([]);
    expect(parseOverpassBuildings({ elements: "x" })).toEqual([]);
  });
});
