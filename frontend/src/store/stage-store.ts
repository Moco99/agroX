import { create } from "zustand";

// ─────────────────────────────────────────
// Section: Stage machine (globe → map → twin) with cinematic transitions
// ─────────────────────────────────────────

export type Stage = "globe" | "map" | "twin";
export const STAGES: readonly Stage[] = ["globe", "map", "twin"];

// idle: nothing in flight · flying: the globe camera is descending towards Iowa · fading: crossfade overlay
// covers the canvas while the next stage mounts · revealing: overlay fading out over the new stage
export type Phase = "idle" | "flying" | "fading" | "revealing";

export type Quality = "high" | "low";

// Durations in ms; the globe flight itself is driven by the scene (see scene/globe/camera-flight.tsx)
export const FADE_MS = 450;
export const REVEAL_MS = 700;
export const AUTOPILOT_GLOBE_HOLD_MS = 2600;
export const AUTOPILOT_MAP_HOLD_MS = 5200;

interface StageStore {
  stage: Stage;
  phase: Phase;
  pending: Stage | null;
  // True while the intro plays itself (globe → map → twin); any user navigation cancels it
  autopilot: boolean;
  reducedMotion: boolean;
  // True when the twin stage should play its descent (top-down → isometric) on mount
  twinIntro: boolean;
  quality: Quality;
  fps: number;
  showCredits: boolean;
  goTo: (stage: Stage, opts?: { instant?: boolean }) => void;
  next: () => void;
  back: () => void;
  skipIntro: () => void;
  cancelAutopilot: () => void;
  // Called by the globe scene when the flight reaches the region
  arrived: () => void;
  setQuality: (q: Quality) => void;
  setFps: (fps: number) => void;
  setShowCredits: (v: boolean) => void;
  consumeTwinIntro: () => void;
}

function isStage(v: string | null): v is Stage {
  return v === "globe" || v === "map" || v === "twin";
}

function readDeepLink(): Stage | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("stage");
  return isStage(value) ? value : null;
}

function writeDeepLink(stage: Stage): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("stage", stage);
  window.history.replaceState(null, "", url);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// The cinematic intro runs once per browser session; a reload after that lands directly on the twin
const INTRO_KEY = "agrox.intro.seen";

function introSeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Storage can be blocked (private mode); the intro simply replays
  }
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null;

export const useStageStore = create<StageStore>((set, get) => {
  const deepLink = readDeepLink();
  const reduced = prefersReducedMotion();
  const initial: Stage = deepLink ?? (introSeen() ? "twin" : "globe");
  // Autopilot only for the organic first visit: a deep link or reduced motion means the user chose a view
  const autopilot = deepLink === null && !reduced && initial === "globe";

  const commit = (stage: Stage) => {
    set({ stage, pending: null, phase: "revealing" });
    writeDeepLink(stage);
    if (stage === "twin") markIntroSeen();
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => set({ phase: "idle" }), REVEAL_MS);
  };

  return {
    stage: initial,
    phase: "idle",
    pending: null,
    autopilot,
    reducedMotion: reduced,
    twinIntro: initial !== "twin" && !reduced,
    quality: "high",
    fps: 0,
    showCredits: false,

    goTo: (stage, opts) => {
      const s = get();
      if (stage === s.stage && s.phase === "idle") return;
      if (fadeTimer) clearTimeout(fadeTimer);
      const instant = opts?.instant === true || s.reducedMotion;
      if (instant) {
        set({ stage, pending: null, phase: "idle", twinIntro: false });
        writeDeepLink(stage);
        if (stage === "twin") markIntroSeen();
        return;
      }
      // Going forward into the twin earns the descent animation; coming back to it does not
      set({ twinIntro: stage === "twin" && s.stage !== "twin" });
      if (s.stage === "globe" && stage !== "globe") {
        // The globe scene owns the flight and calls arrived(); the fade starts only on arrival
        set({ pending: stage, phase: "flying" });
        return;
      }
      set({ pending: stage, phase: "fading" });
      fadeTimer = setTimeout(() => commit(stage), FADE_MS);
    },

    next: () => {
      const i = STAGES.indexOf(get().stage);
      const target = STAGES[Math.min(STAGES.length - 1, i + 1)];
      if (target) get().goTo(target);
    },

    back: () => {
      const i = STAGES.indexOf(get().stage);
      const target = STAGES[Math.max(0, i - 1)];
      get().cancelAutopilot();
      if (target) get().goTo(target, { instant: true });
    },

    skipIntro: () => {
      get().cancelAutopilot();
      get().goTo("twin", { instant: true });
    },

    cancelAutopilot: () => {
      if (get().autopilot) set({ autopilot: false });
    },

    arrived: () => {
      const { pending, phase } = get();
      if (phase !== "flying" || !pending) return;
      set({ phase: "fading" });
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => commit(pending), FADE_MS);
    },

    setQuality: (quality) => set({ quality }),
    setFps: (fps) => set({ fps }),
    setShowCredits: (showCredits) => set({ showCredits }),
    consumeTwinIntro: () => set({ twinIntro: false }),
  };
});
