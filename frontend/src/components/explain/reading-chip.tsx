import { es } from "../../i18n/es";
import type { Reading, Tone } from "../../lib/readings";

// ─────────────────────────────────────────
// Section: Good / warn / bad / neutral reading chip
// ─────────────────────────────────────────

// Colour is never the only signal: an icon and the verdict word are always rendered
const ICONS: Record<Tone, string> = { good: "✓", warn: "!", bad: "✕", neutral: "•" };

export function ReadingChip({ reading }: { reading: Reading | null | undefined }) {
  if (!reading) return null;
  return (
    <span className={`reading is-${reading.tone}`} data-tone={reading.tone}>
      <i aria-hidden>{ICONS[reading.tone]}</i>
      <span className="sr-only">{es.tones[reading.tone]}: </span>
      {reading.label}
    </span>
  );
}
