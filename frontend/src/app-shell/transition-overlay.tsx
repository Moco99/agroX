import { useStageStore } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Crossfade overlay between stages (CSS opacity driven by the stage phase)
// ─────────────────────────────────────────

export function TransitionOverlay() {
  const phase = useStageStore((s) => s.phase);
  const reduced = useStageStore((s) => s.reducedMotion);
  // With reduced motion the stages swap instantly, so the overlay never shows
  if (reduced || phase === "idle" || phase === "flying") return null;
  return <div className={`stage-fade is-${phase}`} aria-hidden />;
}
