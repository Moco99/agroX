import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOBE_VIEW, PILOT_VIEW } from "../lib/globe-view";
import { useParcelStore } from "./parcel-store";
import { initialCamera, resolveFlight, useMapStore } from "./map-store";
import { FADE_MS, readDeepLink, REVEAL_MS, useStageStore } from "./stage-store";

// ─────────────────────────────────────────
// Section: Stage machine (globe → map → twin)
// ─────────────────────────────────────────

function reset(stage: "globe" | "map" | "twin" = "globe"): void {
  useStageStore.setState({ stage, phase: "idle", pending: null, reducedMotion: false, twinIntro: false });
  useMapStore.setState({ flight: null, interacted: false, selected: null });
}

describe("readDeepLink", () => {
  it("accepts only the three stages", () => {
    expect(readDeepLink("?stage=twin")).toBe("twin");
    expect(readDeepLink("?stage=map&x=1")).toBe("map");
    expect(readDeepLink("?stage=moon")).toBeNull();
    expect(readDeepLink("")).toBeNull();
    expect(readDeepLink(null)).toBeNull();
  });
});

describe("stage store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });
  afterEach(() => vi.useRealTimers());

  it("fades into the twin and earns the descent animation", () => {
    useStageStore.getState().goTo("twin");
    expect(useStageStore.getState()).toMatchObject({ phase: "fading", pending: "twin", stage: "globe", twinIntro: true });
    vi.advanceTimersByTime(FADE_MS);
    expect(useStageStore.getState()).toMatchObject({ stage: "twin", phase: "revealing" });
    vi.advanceTimersByTime(REVEAL_MS);
    expect(useStageStore.getState().phase).toBe("idle");
  });

  it("swaps instantly with reduced motion", () => {
    useStageStore.setState({ reducedMotion: true });
    useStageStore.getState().goTo("twin");
    expect(useStageStore.getState()).toMatchObject({ stage: "twin", phase: "idle", twinIntro: false });
  });

  it("lets the camera move between globe and map, but never out of the twin", () => {
    useStageStore.getState().setGeoStage("map");
    expect(useStageStore.getState().stage).toBe("map");
    reset("twin");
    useStageStore.getState().setGeoStage("globe");
    expect(useStageStore.getState().stage).toBe("twin");
  });

  it("holds the stage during a flight and lands where the camera ended", () => {
    useMapStore.getState().flyTo("pilot");
    expect(useStageStore.getState()).toMatchObject({ phase: "flying", pending: "map", stage: "globe" });
    // Camera-driven swaps are ignored mid-flight
    useStageStore.getState().setGeoStage("map");
    expect(useStageStore.getState().stage).toBe("globe");
    useStageStore.getState().endFlight("map");
    expect(useStageStore.getState()).toMatchObject({ phase: "idle", pending: null, stage: "map" });
  });

  it("ignores flight starts while the twin is shown", () => {
    reset("twin");
    useStageStore.getState().startFlight("globe");
    expect(useStageStore.getState().phase).toBe("idle");
  });
});

// ─────────────────────────────────────────
// Section: Map store (flight requests)
// ─────────────────────────────────────────

describe("map store", () => {
  beforeEach(() => reset());

  it("resolves named destinations", () => {
    expect(resolveFlight("pilot")).toBe(PILOT_VIEW);
    expect(resolveFlight("globe")).toBe(GLOBE_VIEW);
    expect(initialCamera("globe")).toBe(GLOBE_VIEW);
    expect(initialCamera("twin")).toEqual(PILOT_VIEW);
  });

  it("flies to the active parcel and lands on the farm stage", () => {
    useParcelStore.getState().setFarm("pt_18.83_-96.78");
    expect(resolveFlight("parcel").center).toEqual([-96.78, 18.83]);
    useMapStore.getState().flyTo("parcel");
    expect(useStageStore.getState()).toMatchObject({ phase: "flying", pending: "map" });
    useParcelStore.getState().setFarm("story_pilot_farm");
  });

  it("issues monotonic flight ids, stops the idle spin and is consumed once", () => {
    useMapStore.getState().flyTo("globe");
    const first = useMapStore.getState().flight;
    useMapStore.getState().flyTo("globe");
    const second = useMapStore.getState().flight;
    expect(first && second && second.id > first.id).toBe(true);
    expect(useMapStore.getState().interacted).toBe(true);
    if (first) useMapStore.getState().consumeFlight(first.id);
    expect(useMapStore.getState().flight).toBe(second);
    if (second) useMapStore.getState().consumeFlight(second.id);
    expect(useMapStore.getState().flight).toBeNull();
  });
});
