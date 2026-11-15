import { useId, type ReactNode } from "react";
import { es } from "../../i18n/es";

// ─────────────────────────────────────────
// Section: Glossary tooltip for jargon (NDVI, ET0, Kc, GDD, SPI, Ks…)
// ─────────────────────────────────────────

export type GlossaryTermId = keyof typeof es.glossary;

// Pure CSS tooltip on hover and keyboard focus: it renders in static markup (tests, print) and works on touch
// because a tap focuses the element. The definition is also exposed via aria-describedby for screen readers.
export function Term({ id, children }: { id: GlossaryTermId; children?: ReactNode }) {
  const tipId = useId();
  const entry = es.glossary[id];
  return (
    <span className="term" tabIndex={0} aria-describedby={tipId} data-term={id}>
      <span className="term-label">{children ?? entry.term}</span>
      <span className="term-mark" aria-hidden>
        ?
      </span>
      <span role="tooltip" id={tipId} className="term-tip">
        <strong>{entry.term}:</strong> {entry.text}
      </span>
    </span>
  );
}
