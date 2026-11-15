import { es } from "../i18n/es";
import { useStageStore } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Floating intro controls (skip + stage navigation CTA)
// ─────────────────────────────────────────

export function IntroControls() {
  const stage = useStageStore((s) => s.stage);
  const phase = useStageStore((s) => s.phase);
  const autopilot = useStageStore((s) => s.autopilot);
  const skipIntro = useStageStore((s) => s.skipIntro);
  if (stage === "twin") return null;
  return (
    <div className="intro-controls">
      {autopilot && phase === "idle" && <span className="intro-hint">{es.stages.autoplay}</span>}
      {phase === "flying" && <span className="intro-hint is-flying">{es.stages.flying}</span>}
      <button type="button" className="ghost-button skip-button" onClick={skipIntro}>
        {es.stages.skip} <kbd>{es.stages.skipHint}</kbd>
      </button>
    </div>
  );
}
