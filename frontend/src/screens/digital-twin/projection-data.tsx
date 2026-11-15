import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmtDate } from "../../i18n/es";
import { scenarioLabel } from "../../lib/climate-projection";
import type { ClimateProjectionInfo } from "../../types/api";

// ─────────────────────────────────────────
// Section: "Datos que usa esta simulación" (exactly what fed a projection run, as returned by the backend)
// ─────────────────────────────────────────

export function ProjectionData({ info }: { info: ClimateProjectionInfo }) {
  const t = es.projection;
  const filled = Object.entries(info.filled_days);
  const failed = Object.keys(info.models_failed);
  return (
    <details className="projection-data" open data-testid="projection-data">
      <summary>
        {t.dataTitle} <DataStateBadge state={info.data_state} compact />
      </summary>
      <dl>
        <dt>{t.source}</dt>
        <dd>{info.source} · {scenarioLabel(info.scenario)}</dd>
        <dt>{t.models}</dt>
        <dd>{info.models_used.join(", ")}</dd>
        <dt>{t.animated}</dt>
        <dd>{info.animated_model}. {info.animated_rule}</dd>
        {failed.length > 0 && (
          <>
            <dt>{t.modelsFailed}</dt>
            <dd>{failed.join(", ")}</dd>
          </>
        )}
        <dt>{t.variables}</dt>
        <dd><ul>{info.variables.map((v) => <li key={v}>{v}</li>)}</ul></dd>
        <dt>{t.conversions}</dt>
        <dd><ul>{info.conversions.map((c) => <li key={c}>{c}</li>)}</ul></dd>
        <dt>{t.filled}</dt>
        <dd>
          {filled.length === 0 ? t.noFilled : (
            <ul>{filled.map(([model, ranges]) => <li key={model}>{model}: {ranges.join(", ")}</li>)}</ul>
          )}
        </dd>
        <dt>{t.coverage}</dt>
        <dd>{t.coverageRange(fmtDate(info.api_first_day), fmtDate(info.api_last_day))}. {t.coverageHint}</dd>
      </dl>
    </details>
  );
}
