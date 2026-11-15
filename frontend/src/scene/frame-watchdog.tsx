import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useQuality } from "./quality-context";

// ─────────────────────────────────────────
// Section: Frame-rate watchdog (steps the quality tier down when the scene cannot keep up)
// ─────────────────────────────────────────

// Below this average for two consecutive windows the tier drops; well under 60 so a busy tab does not trigger it
const MIN_FPS = 26;
const WINDOW_S = 2;
// The first seconds include shader compilation and texture uploads, which are not steady-state cost
const WARMUP_S = 3;

export function FrameWatchdog({ onDegrade }: { onDegrade: (reason: string) => void }) {
  const quality = useQuality();
  const frames = useRef(0);
  const elapsed = useRef(0);
  const slowWindows = useRef(0);
  const age = useRef(0);
  useFrame((_, delta) => {
    // Only a continuous loop gives a meaningful frame rate; demand mode renders sparsely by design
    if (quality.frameloop !== "always") return;
    age.current += delta;
    if (age.current < WARMUP_S) return;
    // A hidden tab throttles requestAnimationFrame to a crawl; that is not the GPU's fault
    if (typeof document !== "undefined" && document.hidden) return;
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
