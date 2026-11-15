import { DataStateBadge } from "../../components/data-state-badge";
import { es } from "../../i18n/es";
import { outcomeText } from "../../lib/season-outcome";
import type { TwinSimulateResponse } from "../../types/api";

// ─────────────────────────────────────────
// Section: "Resultado de la temporada" (per-zone cycle verdict of a run; shared by the twin panel and Informes)
// ─────────────────────────────────────────

export function SeasonOutcomeList({ run }: { run: TwinSimulateResponse }) {
  const zones = run.zones.filter((z) => z.outcome);
  if (zones.length === 0) return <p className="muted">{es.seasonOutcome.none}</p>;
  return (
    <>
      <ul className="season-outcome" data-testid="season-outcome">
        {zones.map((z) => z.outcome && (
          <li key={z.zone_id}>
            <strong>{z.name}</strong> <DataStateBadge state={z.outcome.data_state} compact />{" "}
            {outcomeText(z.outcome)}
            {!z.outcome.planted_in_window && z.outcome.status !== "NOT_PLANTED" && ` ${es.seasonOutcome.plantedOutside}`}
          </li>
        ))}
      </ul>
      <small className="muted">{es.seasonOutcome.note}</small>
    </>
  );
}

export function SeasonOutcomeCard({ run }: { run: TwinSimulateResponse }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{es.seasonOutcome.title}</h3>
        <DataStateBadge state={run.data_mode === "synthetic" ? "SYNTHETIC" : "SIMULATED"} compact />
      </div>
      <small className="muted">{es.seasonOutcome.hint}</small>
      <SeasonOutcomeList run={run} />
    </section>
  );
}
