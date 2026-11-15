import type { PhenoStage, TwinState } from "../types/api";

// ─────────────────────────────────────────
// Section: Stage marks of the timeline (first day of each crop stage, placed by date inside the run window)
// ─────────────────────────────────────────

export interface StageMark {
  index: number;
  stage: PhenoStage;
  // Position on the track, 0–100 %
  pct: number;
  // False when the label would overlap the previous labelled mark; the tick stays, the name goes to its tooltip
  labelled: boolean;
}

// Minimum distance between two visible labels, in % of the track (about one short word at desktop width)
const MIN_LABEL_GAP_PCT = 9;

export function stageMarks(states: TwinState[], start: string, end: string): StageMark[] {
  const t0 = Date.parse(start);
  const span = Math.max(1, Date.parse(end) - t0);
  const out: StageMark[] = [];
  let lastLabelled = -Infinity;
  states.forEach((s, i) => {
    if (s.stage === "PRE_PLANTING" || (i > 0 && states[i - 1]?.stage === s.stage)) return;
    const pct = Math.min(100, Math.max(0, ((Date.parse(s.date) - t0) / span) * 100));
    const labelled = pct - lastLabelled >= MIN_LABEL_GAP_PCT;
    if (labelled) lastLabelled = pct;
    out.push({ index: i, stage: s.stage, pct, labelled });
  });
  return out;
}
