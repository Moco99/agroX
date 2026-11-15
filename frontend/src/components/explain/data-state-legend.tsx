import { es } from "../../i18n/es";
import type { DataState } from "../../types/api";
import { DataStateBadge } from "../data-state-badge";

// ─────────────────────────────────────────
// Section: Legend of provenance badges (what MEASURED / DECLARED / … mean)
// ─────────────────────────────────────────

const ALL: DataState[] = ["MEASURED", "DECLARED", "ESTIMATED", "SIMULATED", "SYNTHETIC"];

// Collapsible by default so it can sit on every screen without pushing the numbers down
export function DataStateLegend({ open = false, states = ALL }: { open?: boolean; states?: DataState[] }) {
  return (
    <details className="state-legend" open={open} data-testid="data-state-legend">
      <summary>{es.dataStateTitle}</summary>
      <ul>
        {states.map((s) => (
          <li key={s}>
            <DataStateBadge state={s} /> <span>{es.dataStateHelp[s]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
