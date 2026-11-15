import { useId, useRef, useState, type ReactNode } from "react";
import { es } from "../../i18n/es";

// ─────────────────────────────────────────
// Section: Glossary tooltip for jargon (NDVI, ET0, Kc, GDD, SPI, Ks…)
// ─────────────────────────────────────────

export type GlossaryTermId = keyof typeof es.glossary;

// Bubble width in CSS (max 280 px) plus a margin, used to decide on which side the bubble fits
const TIP_WIDTH_PX = 300;

// CSS shows the bubble on hover and on keyboard/tap focus, so it renders in static markup (tests, print).
// Two pieces of state keep it WCAG 1.4.13-friendly: Esc dismisses it until the pointer/focus leaves, and the
// bubble flips to the left edge when it would overflow the viewport on the right.
export function Term({ id, children }: { id: GlossaryTermId; children?: ReactNode }) {
  const tipId = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const entry = es.glossary[id];

  const place = () => {
    setDismissed(false);
    const rect = ref.current?.getBoundingClientRect();
    if (rect && typeof window !== "undefined") setAlignRight(rect.left + TIP_WIDTH_PX > window.innerWidth);
  };

  return (
    <span
      ref={ref}
      className={`term${dismissed ? " is-dismissed" : ""}${alignRight ? " is-right" : ""}`}
      tabIndex={0}
      aria-describedby={tipId}
      data-term={id}
      onMouseEnter={place}
      onFocus={place}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Stop here so Esc closes only the tooltip, not the overlay the term lives in
          e.stopPropagation();
          setDismissed(true);
        }
      }}
    >
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
