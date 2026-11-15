import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useQuality } from "./quality-context";

// ─────────────────────────────────────────
// Section: Frame-rate watchdog (steps the quality tier down when the scene cannot keep up)
// ─────────────────────────────────────────

// Below this average for two consecutive windows the tier drops; well under 60 so a busy tab does not trigger it
const MIN_FPS = 26;
const WINDOW_S = 2;
// The first seconds include shader compilation and texture uploads, which are not steady-state cost
const WARMUP_S = 3;
// A single frame longer than this is a stall (tab switch, breakpoint, GC), not a sustained frame rate
const MAX_DELTA_S = 0.25;

export function FrameWatchdog({ onDegrade }: { onDegrade: (reason: string) => void }) {
  const quality = useQuality();
  const frames = useRef(0);
  const elapsed = useRef(0);
  const slowWindows = useRef(0);
  const age = useRef(0);

  // Coming back from a hidden tab must start a fresh measurement: the throttled frames while hidden
  // and the catch-up frame on return say nothing about the GPU
  useEffect(() => {
    const reset = () => {
      frames.current = 0;
      elapsed.current = 0;
      slowWindows.current = 0;
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);

  useFrame((_, delta) => {
    // Only continuous animation gives a meaningful frame rate; demand-only tiers render sparsely by design
    if (!quality.animate) return;
    age.current += delta;
    if (age.current < WARMUP_S) return;
    if (document.hidden) return;
    if (delta > MAX_DELTA_S) {
      frames.current = 0;
      elapsed.current = 0;
      return;
    }
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current < WINDOW_S) return;
    const fps = frames.current / elapsed.current;
    frames.current = 0;
    elapsed.current = 0;
    slowWindows.current = fps < MIN_FPS ? slowWindows.current + 1 : 0;
    if (slowWindows.current >= 2) {
      slowWindows.current = 0;
      age.current = 0;
      onDegrade(`${fps.toFixed(0)} fps`);
    }
  });
  return null;
}
