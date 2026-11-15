import { es } from "../../i18n/es";
import { useGuideStore } from "../../store/guide-store";

// ─────────────────────────────────────────
// Section: Transparent-model note (process model, not black-box ML; score is comparative)
// ─────────────────────────────────────────

// Shown near every score or simulated number so the non-expert reads the honesty rules before the figures
export function ModelNote({ withScore = true, compact = false }: { withScore?: boolean; compact?: boolean }) {
  const setOpen = useGuideStore((s) => s.setOpen);
  return (
    <aside className={`model-note${compact ? " is-compact" : ""}`} role="note" data-testid="model-note">
      <strong>
        <span aria-hidden>◇ </span>
        {es.modelNote.title}
      </strong>
      <p>{es.modelNote.body}</p>
      {withScore && <p>{es.modelNote.score}</p>}
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        {es.modelNote.openGuide}
      </button>
    </aside>
  );
}
