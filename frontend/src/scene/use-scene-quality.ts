import { useCallback, useMemo, useState } from "react";
import {
  lowerQuality,
  parseQualityOverride,
  pickQuality,
  probeGpuHints,
  qualitySettings,
  type QualitySettings,
  type SceneQuality,
} from "../lib/scene-quality";

// ─────────────────────────────────────────
// Section: Quality tier state (probe once, step down on trouble, never step back up)
// ─────────────────────────────────────────
//
// Stepping back up would make the scene oscillate on a machine that is borderline; a reload
// re-probes. `?quality=high|medium|low` pins the tier for demos and screenshots.

export interface SceneQualityState {
  quality: SceneQuality;
  settings: QualitySettings;
  // Lowers the tier one step (no-op on "low" or when the tier is pinned by the URL)
  degrade: (reason: string) => void;
}

export function useSceneQuality(): SceneQualityState {
  const [probe] = useState(() => {
    const hints = probeGpuHints();
    const override = typeof window === "undefined" ? null : parseQualityOverride(window.location.search);
    return { override, reducedMotion: hints.reducedMotion, initial: override ?? pickQuality(hints) };
  });
  const [quality, setQuality] = useState<SceneQuality>(probe.initial);
  const degrade = useCallback(
    (reason: string) => {
      if (probe.override) return;
      setQuality((q) => {
        const next = lowerQuality(q);
        if (next !== q && typeof console !== "undefined") console.info(`[scene] quality ${q} → ${next}: ${reason}`);
        return next;
      });
    },
    [probe.override],
  );
  const settings = useMemo(() => qualitySettings(quality, probe.reducedMotion), [quality, probe.reducedMotion]);
  return { quality, settings, degrade };
}
