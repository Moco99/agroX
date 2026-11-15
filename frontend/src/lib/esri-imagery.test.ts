import { describe, expect, it } from "vitest";
import { esriTileUrl, pickZoom, tileXY } from "./esri-imagery";

describe("esri imagery tiling", () => {
  it("maps lon/lat to Web Mercator tiles", () => {
    expect(tileXY(0, 0, 1)).toEqual([1, 1]);
    const [x] = tileXY(-180, 0, 3);
    expect(x).toBe(0);
  });
  it("keeps the tile cover small", () => {
    const z = pickZoom({ west: -96.8, east: -96.79, south: 18.83, north: 18.84 });
    expect(z).toBeLessThanOrEqual(18);
    expect(z).toBeGreaterThan(14);
    expect(esriTileUrl(5, 3, 4)).toContain("/tile/5/4/3");
  });
});
