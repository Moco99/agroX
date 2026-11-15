import { es } from "../../i18n/es";
import { explain } from "../../lib/explain";
import type { TwinSimulateResponse } from "../../types/api";

export function ExplanationBox({
  baseline,
  scenario,
  selectedZoneId,
}: {
  baseline: TwinSimulateResponse;
  scenario: TwinSimulateResponse | null;
  selectedZoneId: string | null;
}) {
  const { paragraphs, suggestion } = explain(baseline, scenario, selectedZoneId);
  return (
    <section className="card explanation">
      <div className="card-head">
        <h3>✦ {es.explanation.title}</h3>
      </div>
      <small className="muted">{es.explanation.subtitle}</small>
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {suggestion && (
        <div className="suggestion">
          <strong>{es.explanation.suggestion}:</strong> {suggestion}
        </div>
      )}
    </section>
  );
}
