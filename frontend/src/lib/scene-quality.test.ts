import { describe, expect, it } from "vitest";
import { lowerQuality, parseQualityOverride, pickQuality, qualitySettings, type GpuHints } from "./scene-quality";

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

  it("disables motion under reduced motion and on the low tier", () => {
    expect(qualitySettings("high", true).wind).toBe(false);
    expect(qualitySettings("high", true).animate).toBe(false);
    expect(qualitySettings("high").animate).toBe(true);
    expect(qualitySettings("low").shadows).toBe(false);
    expect(qualitySettings("low").animate).toBe(false);
  });
});
