import { describe, expect, it } from "vitest";
import {
  buildGlobeStyle,
  CROSSFADE_END,
  CROSSFADE_START,
  defaultPointRange,
  distanceKm,
  GLOBE_VIEW,
  insideBounds,
  MAP_ENTER_ZOOM,
  MAP_EXIT_ZOOM,
  metresPerPixel,
  normalizeLon,
  PILOT_CENTER,
  PILOT_VIEW,
  SOURCE,
  stageForCamera,
} from "./globe-view";

// ─────────────────────────────────────────
// Section: Geographic helpers
// ─────────────────────────────────────────

describe("normalizeLon", () => {
  it("keeps canonical longitudes", () => {
    expect(normalizeLon(-93.49)).toBeCloseTo(-93.49);
    expect(normalizeLon(0)).toBe(0);
  });
  it("wraps longitudes produced by spinning the globe", () => {
    expect(normalizeLon(266.51)).toBeCloseTo(-93.49);
    expect(normalizeLon(-453.49)).toBeCloseTo(-93.49);
  });
  it("keeps the antimeridian sign", () => {
    expect(normalizeLon(180)).toBe(180);
    expect(normalizeLon(-180)).toBe(-180);
  });
});

describe("insideBounds", () => {
  const b = { west: -93.5, east: -93.48, south: 42.02, north: 42.04 };
  it("detects points in the pilot box", () => {
    expect(insideBounds({ lat: 42.03, lon: -93.49 }, b)).toBe(true);
  });
  it("rejects points elsewhere", () => {
    expect(insideBounds({ lat: -33.9, lon: -60.6 }, b)).toBe(false);
  });
});

describe("distanceKm", () => {
  it("is zero for the same point and ~111 km per degree of latitude", () => {
    expect(distanceKm(PILOT_CENTER, PILOT_CENTER)).toBeCloseTo(0);
    expect(distanceKm([0, 0], [0, 1])).toBeCloseTo(111.2, 0);
  });
});

describe("metresPerPixel", () => {
  it("halves with every zoom level", () => {
    expect(metresPerPixel(10, 0) / metresPerPixel(11, 0)).toBeCloseTo(2);
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });
});

describe("defaultPointRange", () => {
  it("ends a week ago and spans 730 days", () => {
    const r = defaultPointRange(new Date(Date.UTC(2026, 10, 14)));
    expect(r).toEqual({ start: "2024-11-07", end: "2026-11-07" });
  });
});

// ─────────────────────────────────────────
// Section: Continuous-zoom stage decisions
// ─────────────────────────────────────────

describe("stageForCamera", () => {
  it("enters the farm stage only when zoomed in over the pilot", () => {
    expect(stageForCamera("globe", PILOT_VIEW)).toBe("map");
    expect(stageForCamera("globe", { center: PILOT_CENTER, zoom: MAP_ENTER_ZOOM - 0.5 })).toBe("globe");
    expect(stageForCamera("globe", { center: [-60.68, -33.97], zoom: 15 })).toBe("globe");
  });
  it("leaves the farm stage when zooming out or panning away (hysteresis)", () => {
    expect(stageForCamera("map", { center: PILOT_CENTER, zoom: MAP_EXIT_ZOOM + 0.5 })).toBe("map");
    expect(stageForCamera("map", { center: PILOT_CENTER, zoom: MAP_EXIT_ZOOM - 0.1 })).toBe("globe");
    expect(stageForCamera("map", { center: [-96.36, 19.39], zoom: 14 })).toBe("globe");
    expect(stageForCamera("map", GLOBE_VIEW)).toBe("globe");
  });
  it("accepts unwrapped longitudes from a spun globe", () => {
    expect(stageForCamera("globe", { center: [PILOT_CENTER[0] + 360, PILOT_CENTER[1]], zoom: 15 })).toBe("map");
  });
});

// ─────────────────────────────────────────
// Section: Style contract
// ─────────────────────────────────────────

describe("buildGlobeStyle", () => {
  const style = buildGlobeStyle();
  it("uses the globe projection with an atmosphere", () => {
    expect(style.projection).toEqual({ type: "globe" });
    expect(style.sky?.["atmosphere-blend"]).toBeDefined();
  });
  it("stacks offline fallback, NASA GIBS and Esri in that order", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf(SOURCE.fallback)).toBeLessThan(ids.indexOf(SOURCE.gibs));
    expect(ids.indexOf(SOURCE.gibs)).toBeLessThan(ids.indexOf(SOURCE.esri));
  });
  it("crossfades GIBS into Esri without requesting Esri at globe scale", () => {
    const esri = style.layers.find((l) => l.id === SOURCE.esri);
    const gibs = style.layers.find((l) => l.id === SOURCE.gibs);
    expect(esri?.minzoom).toBe(CROSSFADE_START);
    expect(gibs?.maxzoom).toBeGreaterThan(CROSSFADE_END);
  });
  it("never asks GIBS beyond its native level 8", () => {
    const src = style.sources[SOURCE.gibs];
    expect(src && "maxzoom" in src ? src.maxzoom : null).toBe(8);
  });
});
