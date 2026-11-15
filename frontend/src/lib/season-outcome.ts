import { es, fmt, fmtDate } from "../i18n/es";
import type { SeasonOutcome } from "../types/api";

// ─────────────────────────────────────────
// Section: Plain-language season verdict (wording only; the verdict itself comes from the backend engine)
// ─────────────────────────────────────────

export function outcomeText(o: SeasonOutcome): string {
  const t = es.seasonOutcome;
  const parts: string[] = [];
  if (o.status === "NOT_PLANTED") parts.push(t.notPlanted);
  else if (o.status === "NOT_MATURE") {
    parts.push(t.notMature(fmt(o.gdd_accumulated, 0), fmt(o.gdd_required, 0)));
    if (o.stress_days > 0) parts.push(t.alsoStress(o.stress_days));
  } else {
    parts.push(o.stress_days > 0 ? t.completedStress(o.stress_days) : t.completed);
    if (o.maturity_date) parts.push(t.maturity(fmtDate(o.maturity_date)));
  }
  if (o.status !== "NOT_PLANTED" && o.frost_days > 0) parts.push(t.frost(o.frost_days));
  return parts.join(" ");
}
