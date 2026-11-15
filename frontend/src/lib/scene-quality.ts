// ─────────────────────────────────────────
// Section: 3D scene quality tiers (pure: hints in, settings out)
// ─────────────────────────────────────────

export type SceneQuality = "high" | "medium" | "low";

export interface GpuHints {
  // UNMASKED_RENDERER_WEBGL string when the browser exposes it
  renderer: string | null;
  maxTextureSize: number;
  cores: number | null;
  memoryGb: number | null;
  mobile: boolean;
  reducedMotion: boolean;
}

export interface QualitySettings {
  dpr: [number, number];
  shadows: boolean;
  shadowMapSize: number;
  ambientOcclusion: boolean;
  bloom: boolean;
  vignette: boolean;
  multisampling: number;
  // Fraction of the full plant density (1 = densest rows the scene draws)
  plantDensity: number;
  maxPlantsPerZone: number;
  wind: boolean;
  // "always" animates wind and irrigation; "demand" only redraws on change
  frameloop: "always" | "demand";
}

// Software rasterisers cannot hold a shaded scene at interactive rates
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;
// Older Intel integrated GPUs struggle with AO + shadows; Iris Xe and Apple silicon cope
const WEAK_INTEGRATED = /intel\(r\) (hd|uhd) graphics|mali-[gt]\d|adreno \(tm\) [1-5]\d\d/i;

export function pickQuality(h: GpuHints): SceneQuality {
  if (h.renderer && SOFTWARE_RENDERER.test(h.renderer)) return "low";
  if (h.maxTextureSize > 0 && h.maxTextureSize < 4096) return "low";
  if (h.mobile) return "medium";
  if (h.renderer && WEAK_INTEGRATED.test(h.renderer)) return "medium";
  if ((h.memoryGb !== null && h.memoryGb <= 4) || (h.cores !== null && h.cores <= 4)) return "medium";
  return "high";
}

export function lowerQuality(q: SceneQuality): SceneQuality {
  return q === "high" ? "medium" : "low";
}

export function parseQualityOverride(search: string): SceneQuality | null {
  const value = new URLSearchParams(search).get("quality");
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

const SETTINGS: Record<SceneQuality, QualitySettings> = {
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    ambientOcclusion: true,
    bloom: true,
    vignette: true,
    multisampling: 4,
    plantDensity: 1,
    maxPlantsPerZone: 3200,
    wind: true,
    frameloop: "always",
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    ambientOcclusion: false,
    bloom: true,
    vignette: true,
    multisampling: 0,
    plantDensity: 0.6,
    maxPlantsPerZone: 1600,
    wind: true,
    frameloop: "always",
  },
  low: {
    dpr: [1, 1],
    shadows: false,
    shadowMapSize: 512,
    ambientOcclusion: false,
    bloom: false,
    vignette: false,
    multisampling: 0,
    plantDensity: 0.35,
    maxPlantsPerZone: 700,
    wind: false,
    frameloop: "demand",
  },
};

export function qualitySettings(q: SceneQuality, reducedMotion = false): QualitySettings {
  const base = SETTINGS[q];
  // Reduced motion: no wind sway; the scene still redraws on demand for transitions
  return reducedMotion ? { ...base, wind: false, frameloop: "demand" } : base;
}

// ─────────────────────────────────────────
// Section: Browser probe (the only impure part; kept tiny so the rules above stay testable)
// ─────────────────────────────────────────

interface NavigatorHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  userAgent?: string;
}

export function probeGpuHints(): GpuHints {
  const nav: NavigatorHints = typeof navigator === "undefined" ? {} : (navigator as NavigatorHints);
  let renderer: string | null = null;
  let maxTextureSize = 0;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const value: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      renderer = typeof value === "string" ? value : null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // Probing is best effort: unknown hardware falls through to the defaults
  }
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  return {
    renderer,
    maxTextureSize,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    mobile: /android|iphone|ipad|mobile/i.test(nav.userAgent ?? ""),
    reducedMotion,
  };
}
