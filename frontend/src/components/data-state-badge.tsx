import { es } from "../i18n/es";
import { color } from "../styles/tokens";
import type { DataState } from "../types/api";

// Each exposed figure carries its provenance class; colour is never the only signal (text label always shown)
const BADGE_COLORS: Record<DataState, string> = {
  MEASURED: color.state.up,
  DECLARED: color.text.secondary,
  ESTIMATED: color.state.info,
  SIMULATED: "#C08CF0",
  SYNTHETIC: color.state.synthetic,
};

export function DataStateBadge({ state, compact = false }: { state: DataState | null; compact?: boolean }) {
  if (!state) return null;
  const c = BADGE_COLORS[state];
  return (
    <span
      className="badge"
      title={`${es.dataState[state]}: ${es.dataStateHelp[state]}`}
      style={{ color: c, borderColor: c, fontSize: compact ? 9 : 10, padding: compact ? "0 4px" : "1px 6px" }}
    >
      {es.dataState[state]}
    </span>
  );
}
