import type { ReactNode } from "react";
import { DataStateBadge } from "../data-state-badge";
import type { Reading } from "../../lib/readings";
import type { DataState } from "../../types/api";
import { HowCalculated, type FormulaId } from "./how-calculated";
import { ReadingChip } from "./reading-chip";

// ─────────────────────────────────────────
// Section: One KPI explained (value + spelled unit + verdict + meaning + provenance + formula)
// ─────────────────────────────────────────

export interface ExplainedMetricProps {
  label: ReactNode;
  value: string;
  unit?: string;
  // Unit spelled out ("milímetros de lámina de agua") so no abbreviation is left unexplained
  unitLong?: string;
  state: DataState | null;
  meaning: string;
  reading?: Reading | null;
  note?: ReactNode;
  how?: FormulaId;
  howCurrent?: string | null;
  children?: ReactNode;
  className?: string;
  testId?: string;
}

export function ExplainedMetric({
  label,
  value,
  unit,
  unitLong,
  state,
  meaning,
  reading,
  note,
  how,
  howCurrent,
  children,
  className,
  testId,
}: ExplainedMetricProps) {
  return (
    <div className={`kpi xmetric${reading ? ` tone-${reading.tone}` : ""}${className ? ` ${className}` : ""}`} data-testid={testId}>
      <div className="kpi-label">
        {label} <DataStateBadge state={state} compact />
      </div>
      <div className="kpi-value">
        {value} {unit && <small>{unit}</small>}
      </div>
      {unitLong && <div className="unit-long">{unitLong}</div>}
      <ReadingChip reading={reading} />
      <p className="xmetric-meaning">{meaning}</p>
      {note && <div className="kpi-note">{note}</div>}
      {children}
      {how && <HowCalculated id={how} current={howCurrent} />}
    </div>
  );
}
