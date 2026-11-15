import { create } from "zustand";

// ─────────────────────────────────────────
// Section: Stage machine (globe → map → twin)
// ─────────────────────────────────────────

// globe and map share one MapLibre view (the stage only changes panels and overlays); twin is the R3F scene
export type Stage = "globe" | "map" | "twin";
export const STAGES: readonly Stage[] = ["globe", "map", "twin"];

// idle: nothing in flight · flying: the map camera is travelling (flyTo) · fading: crossfade overlay covers the
// stage host while the next screen mounts · revealing: overlay fading out over the new screen
export type Phase = "idle" | "flying" | "fading" | "revealing";

// Crossfade timings in ms; the camera flight itself lives in lib/globe-view (FLIGHT_MS)
export const FADE_MS = 450;
export const REVEAL_MS = 700;

interface StageStore {
  stage: Stage;
  phase: Phase;
  // Stage the current flight or fade will land on
  pending: Stage | null;
  reducedMotion: boolean;
  // True when the twin stage should play its descent (top-down → isometric) on mount
  twinIntro: boolean;
  showCredits: boolean;
  goTo: (stage: Stage, opts?: { instant?: boolean }) => void;
  // Camera-driven swap between globe and map: same map instance, so no fade
  setGeoStage: (stage: "globe" | "map") => void;
  startFlight: (target: "globe" | "map") => void;
  // Called by the map when a flight ends (or is interrupted); lands on the stage the camera decided
  endFlight: (stage: "globe" | "map") => void;
  setShowCredits: (v: boolean) => void;
  consumeTwinIntro: () => void;
}

export function isStage(v: string | null): v is Stage {
  return v === "globe" || v === "map" || v === "twin";
}

export function readDeepLink(search: string | null = typeof window === "undefined" ? null : window.location.search): Stage | null {
  if (search === null) return null;
  const value = new URLSearchParams(search).get("stage");
  return isStage(value) ? value : null;
}

function writeDeepLink(stage: Stage): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("stage") === stage) return;
  url.searchParams.set("stage", stage);
  window.history.replaceState(null, "", url);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function clearFade(): void {
  if (fadeTimer) clearTimeout(fadeTimer);
  fadeTimer = null;
}

export const useStageStore = create<StageStore>((set, get) => {
  const reduced = prefersReducedMotion();
  // The app always opens on the globe unless a deep link (?stage=globe|map|twin) asks for another stage
  const initial: Stage = readDeepLink() ?? "globe";

  const commit = (stage: Stage) => {
    set({ stage, pending: null, phase: "revealing" });
    writeDeepLink(stage);
    clearFade();
    fadeTimer = setTimeout(() => set({ phase: "idle" }), REVEAL_MS);
  };

  return {
    stage: initial,
    phase: "idle",
    pending: null,
    reducedMotion: reduced,
    twinIntro: false,
    showCredits: false,

    goTo: (stage, opts) => {
      const s = get();
      if (stage === s.stage && s.phase === "idle") return;
      clearFade();
      // Going forward into the twin earns the descent animation; coming back to it does not
      const twinIntro = stage === "twin" && s.stage !== "twin" && !s.reducedMotion;
      if (opts?.instant === true || s.reducedMotion) {
        set({ stage, pending: null, phase: "idle", twinIntro });
        writeDeepLink(stage);
        return;
      }
      set({ twinIntro, pending: stage, phase: "fading" });
      fadeTimer = setTimeout(() => commit(stage), FADE_MS);
    },

    setGeoStage: (stage) => {
      const s = get();
      // A flight or a fade owns the stage until it finishes; the twin is left only through goTo
      if (s.stage === "twin" || s.phase !== "idle" || s.stage === stage) return;
      set({ stage });
      writeDeepLink(stage);
    },

    startFlight: (target) => {
      if (get().stage === "twin") return;
      clearFade();
      set({ phase: "flying", pending: target });
    },

    endFlight: (stage) => {
      const s = get();
      if (s.phase !== "flying") return;
      set({ stage, phase: "idle", pending: null });
      writeDeepLink(stage);
    },

    setShowCredits: (showCredits) => set({ showCredits }),
    consumeTwinIntro: () => set({ twinIntro: false }),
  };
});
