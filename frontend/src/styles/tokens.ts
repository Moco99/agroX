// ─────────────────────────────────────────
// Section: Design tokens (mirror of docs/07-design/design-tokens.md)
// ─────────────────────────────────────────

export const color = {
  bg: {
    app: "#0B121B",
    sidebar: "#121922",
    panel: "#161D26",
    card: "#1B232B",
    cardRaised: "#202C34",
    navActive: "#1B422E",
  },
  border: { subtle: "#2B333E" },
  overlay: { scrim: "rgba(9, 13, 19, 0.8)" },
  accent: {
    bright: "#7EE36D",
    soft: "#A0DA94",
    strong: "#107432",
    muted: "#5A8549",
  },
  chart: { area: "#234B33" },
  text: {
    primary: "#FFFFFF",
    secondary: "#C5CED5",
    muted: "#8A949E",
    onAccent: "#0B121B",
  },
  state: {
    up: "#81D740",
    down: "#F15F48",
    warn: "#F3B406",
    synthetic: "#F3B406",
    info: "#5AA9E6",
  },
} as const;

export const radius = { sm: 6, md: 10, lg: 16 } as const;
export const space = [4, 8, 12, 16, 24, 32] as const;

// ─────────────────────────────────────────
// Section: Colour ramps
// ─────────────────────────────────────────

export interface RampStop {
  value: number;
  hex: string;
}

// Canonical NDVI ramp (ADR-011): the backend overlay, the 3D scene and every legend use these exact stops
export const NDVI_RAMP: RampStop[] = [
  { value: 0.2, hex: "#DC342E" },
  { value: 0.35, hex: "#F19728" },
  { value: 0.5, hex: "#F0E533" },
  { value: 0.65, hex: "#6FBE30" },
  { value: 0.8, hex: "#319D34" },
];
export const NDVI_NODATA = "#4B5563";

// Ks ramp: 1 = no stress (green) down to 0 (red); stops are visual, the classes come from the backend config
export const STRESS_RAMP: RampStop[] = [
  { value: 0.0, hex: "#DC342E" },
  { value: 0.5, hex: "#F15F48" },
  { value: 0.7, hex: "#F3B406" },
  { value: 0.85, hex: "#C9D94A" },
  { value: 1.0, hex: "#319D34" },
];

// Soil water as fraction of TAW: dry (brown) to field capacity (blue)
export const MOISTURE_RAMP: RampStop[] = [
  { value: 0.0, hex: "#8C5A2B" },
  { value: 0.3, hex: "#C9A15A" },
  { value: 0.5, hex: "#D9D27A" },
  { value: 0.75, hex: "#5AA9E6" },
  { value: 1.0, hex: "#2B6CB0" },
];

// Daily maximum temperature in C
export const TEMPERATURE_RAMP: RampStop[] = [
  { value: 0, hex: "#2B6CB0" },
  { value: 15, hex: "#5AA9E6" },
  { value: 25, hex: "#F0E533" },
  { value: 32, hex: "#F19728" },
  { value: 38, hex: "#DC342E" },
];

// Cumulative irrigation in mm since the start of the period
export const IRRIGATION_RAMP: RampStop[] = [
  { value: 0, hex: "#3A4552" },
  { value: 50, hex: "#5AA9E6" },
  { value: 200, hex: "#2B6CB0" },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

// Linear interpolation in RGB between stops, clipped outside the domain (same rule as the backend PNG)
export function rampColor(ramp: RampStop[], value: number | null | undefined, nodata = NDVI_NODATA): string {
  if (value === null || value === undefined || Number.isNaN(value) || ramp.length === 0) return nodata;
  const first = ramp[0];
  const last = ramp[ramp.length - 1];
  if (!first || !last) return nodata;
  if (value <= first.value) return first.hex;
  if (value >= last.value) return last.hex;
  for (let i = 1; i < ramp.length; i += 1) {
    const a = ramp[i - 1];
    const b = ramp[i];
    if (a && b && value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      const [r1, g1, b1] = hexToRgb(a.hex);
      const [r2, g2, b2] = hexToRgb(b.hex);
      return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
    }
  }
  return last.hex;
}
