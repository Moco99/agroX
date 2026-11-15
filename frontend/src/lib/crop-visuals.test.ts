import { describe, expect, it } from "vitest";
import { growthFormFor, rowLayout, soilTone, stageVisual } from "./crop-visuals";
import { lowerQuality, parseQualityOverride, pickQuality, qualitySettings, type GpuHints } from "./scene-quality";

const square: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 600],
  [0, 600],
];

describe("growthFormFor", () => {
  it("maps catalog crops to distinct archetypes", () => {
    expect(growthFormFor("corn")).toBe("tall_grass");
    expect(growthFormFor("soybean")).toBe("bush");
    expect(growthFormFor("cereal_rye")).toBe("small_grain");
    expect(growthFormFor("wheat")).toBe("small_grain");
    expect(growthFormFor("sunflower")).toBe("sunflower");
    expect(growthFormFor("cover_vetch")).toBe("cover");
  });

  it("falls back for unknown crops", () => {
    expect(growthFormFor("cover_mystery")).toBe("cover");
    expect(growthFormFor("quinoa")).toBe("bush");
  });
});

describe("stageVisual", () => {
  it("hides plants before planting and shows stubble after harvest", () => {
    expect(stageVisual("PRE_PLANTING", 0.5).visible).toBe(false);
    const harvested = stageVisual("HARVESTED", 0);
    expect(harvested.stubble).toBe(true);
    expect(harvested.reproductive).toBe(0);
  });

  it("keeps emerged plants visible and only shows reproductive organs from mid season", () => {
    expect(stageVisual("INITIAL", 0).growth).toBeGreaterThan(0);
    expect(stageVisual("DEVELOPMENT", 0.5).reproductive).toBe(0);
    expect(stageVisual("MID_SEASON", 0.9).reproductive).toBe(1);
    expect(stageVisual("LATE_SEASON", 0.3).senescence).toBeGreaterThan(0);
  });

  it("clamps invalid canopy values", () => {
    expect(stageVisual("DEVELOPMENT", Number.NaN).growth).toBeGreaterThan(0);
    expect(stageVisual("DEVELOPMENT", 7).growth).toBe(1);
  });
});

describe("rowLayout", () => {
  it("is deterministic for a seed and stays inside the polygon", () => {
    const opts = { rowSpacingM: 20, plantSpacingM: 15, maxPlants: 5000, seed: 42 };
    const a = rowLayout(square, opts);
    const b = rowLayout(square, opts);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
    expect(a.every((p) => p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 600)).toBe(true);
  });

  it("respects the instance cap by thinning the grid", () => {
    const pts = rowLayout(square, { rowSpacingM: 2, plantSpacingM: 2, maxPlants: 300, seed: 1 });
    expect(pts.length).toBeLessThanOrEqual(300);
    expect(pts.length).toBeGreaterThan(150);
  });

  it("returns nothing for degenerate input", () => {
    expect(rowLayout([[0, 0]], { rowSpacingM: 10, plantSpacingM: 10, maxPlants: 10, seed: 1 })).toEqual([]);
  });
});

describe("soilTone", () => {
  it("darkens as the soil water fraction rises", () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(soilTone(1).hex)).toBeLessThan(lum(soilTone(0).hex));
    expect(soilTone(null).hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("scene quality", () => {
  const base: GpuHints = { renderer: "Apple M2", maxTextureSize: 16384, cores: 8, memoryGb: 8, mobile: false, reducedMotion: false };

  it("picks tiers from hardware hints", () => {
    expect(pickQuality(base)).toBe("high");
    expect(pickQuality({ ...base, renderer: "Google SwiftShader" })).toBe("low");
    expect(pickQuality({ ...base, maxTextureSize: 2048 })).toBe("low");
    expect(pickQuality({ ...base, renderer: "Intel(R) UHD Graphics 620" })).toBe("medium");
    expect(pickQuality({ ...base, mobile: true })).toBe("medium");
  });

  it("steps down and parses overrides", () => {
    expect(lowerQuality("high")).toBe("medium");
    expect(lowerQuality("low")).toBe("low");
    expect(parseQualityOverride("?quality=low")).toBe("low");
    expect(parseQualityOverride("?quality=ultra")).toBeNull();
  });

  it("disables wind under reduced motion", () => {
    expect(qualitySettings("high", true).wind).toBe(false);
    expect(qualitySettings("low").shadows).toBe(false);
  });
});
