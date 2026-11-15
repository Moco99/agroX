import { es } from "../../i18n/es";

// ─────────────────────────────────────────
// Section: Expandable "¿Cómo se calcula?" (white-box formula, inputs and limits in plain words)
// ─────────────────────────────────────────

export type FormulaId = keyof typeof es.formulas;

// Native <details> keeps it keyboard-accessible and printable without state; `current` shows the
// formula with this screen's numbers so the user can follow the arithmetic of the value they see.
export function HowCalculated({ id, current }: { id: FormulaId; current?: string | null }) {
  const f = es.formulas[id];
  return (
    <details className="how" data-formula={id}>
      <summary>{es.how.summary}</summary>
      <div className="how-body">
        <strong className="how-title">{f.title}</strong>
        <ol>
          {f.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p>
          <span className="how-label">{es.how.formula}:</span> <code>{f.formula}</code>
        </p>
        {current && (
          <p>
            <span className="how-label">{es.how.current}:</span> <code>{current}</code>
          </p>
        )}
        <p>
          <span className="how-label">{es.how.inputs}:</span> {f.inputs.join(" · ")}
        </p>
        <p className="muted">
          <span className="how-label">{es.how.limits}:</span> {f.limits}
        </p>
      </div>
    </details>
  );
}
