import { describe, expect, it } from "vitest";
import { farmsteadBox, farmsteadCandidates, fittedZoom, MAX_ZOOM, MIN_ZOOM, pickFarmsteadSite, ringExtent, type Extent } from "./scene-layout";

// 1.2 km pilot-like farm in scene units (scale 0.01)
const farm: Extent = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
// Slab = farm + 300 m on every side
const slab: Extent = { minX: -9, maxX: 9, minZ: -9, maxZ: 9 };

describe("ringExtent", () => {
  it("flips north to -z and applies the scale", () => {
    const e = ringExtent(
      [
        [0, 0],
        [100, 0],
        [100, 200],
      ],
      0.01,
    );
    expect(e).toEqual({ minX: 0, maxX: 1, minZ: -2, maxZ: 0 });
  });
});

describe("fittedZoom", () => {
  it("frames a small parcel tighter than a large one", () => {
    const small: Extent = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    expect(fittedZoom(small, 1200, 900)).toBeGreaterThan(fittedZoom(farm, 1200, 900));
  });

  it("stays inside the OrbitControls limits", () => {
    const huge: Extent = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
    expect(fittedZoom(huge, 1200, 900)).toBe(MIN_ZOOM);
    const tiny: Extent = { minX: 0, maxX: 0.01, minZ: 0, maxZ: 0.01 };
    expect(fittedZoom(tiny, 1200, 900)).toBe(MAX_ZOOM);
  });

  it("falls back to the minimum on degenerate input", () => {
    expect(fittedZoom({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 1200, 900)).toBe(MIN_ZOOM);
    expect(fittedZoom(farm, 0, 900)).toBe(MIN_ZOOM);
  });
});

describe("pickFarmsteadSite", () => {
  it("withholds the farmstead while footprints are unknown or failed", () => {
    expect(pickFarmsteadSite(farm, slab, null)).toBeNull();
  });

  it("takes the first candidate on an empty field and keeps it on the slab", () => {
    const site = pickFarmsteadSite(farm, slab, []);
    expect(site).toEqual(farmsteadCandidates(farm)[0]);
    const box = farmsteadBox(site![0], site![1]);
    expect(box.minX).toBeGreaterThanOrEqual(slab.minX);
    expect(box.maxX).toBeLessThanOrEqual(slab.maxX);
    expect(box.minZ).toBeGreaterThanOrEqual(slab.minZ);
    expect(box.maxZ).toBeLessThanOrEqual(slab.maxZ);
  });

  it("skips a candidate whose yard would overlap a footprint, even without touching its centre", () => {
    const [cx, cz] = farmsteadCandidates(farm)[0]!;
    // A 60 m shed 1.6 units east of the group centre: outside a centroid test, inside the yard box
    const shed: Extent = { minX: cx + 0.8, maxX: cx + 1.4, minZ: cz - 0.3, maxZ: cz + 0.3 };
    const site = pickFarmsteadSite(farm, slab, [shed]);
    expect(site).not.toEqual([cx, cz]);
    expect(site).toEqual(farmsteadCandidates(farm)[1]);
  });

  it("returns null when every candidate is taken or off the slab", () => {
    const everywhere: Extent = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    expect(pickFarmsteadSite(farm, slab, [everywhere])).toBeNull();
    const tightSlab: Extent = { minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5 };
    expect(pickFarmsteadSite(farm, tightSlab, [])).toBeNull();
  });
});
