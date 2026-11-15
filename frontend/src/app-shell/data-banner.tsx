import { useState } from "react";
import { es } from "../i18n/es";
import { activeRun } from "../lib/derive";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Data-state banner (mandatory: says what is real, synthetic, provisional or simulated)
// ─────────────────────────────────────────

export function DataBanner() {
  const health = useTwinStore((s) => s.health);
  const baseline = useTwinStore((s) => s.baseline);
  const scenario = useTwinStore((s) => s.scenario);
  const farm = useTwinStore((s) => s.farm);
  const [open, setOpen] = useState(false);
  if (!health) return null;
  const run = activeRun(baseline, scenario);
  const synthetic = health.data_mode === "synthetic";
  const warnings = Array.from(new Set([...(health.warnings ?? []), ...(run?.warnings ?? []), ...(farm?.warnings ?? [])]));
  return (
    <div className={`data-banner${synthetic ? " is-synthetic" : ""}`} role="status">
      <div className="data-banner-row">
        <strong>{synthetic ? es.banner.synthetic : es.banner.real}</strong>
        {!synthetic && <span>· {es.banner.provisional}</span>}
        <span>· {es.app.exploratory}</span>
        {run && (
          <span className="twin-level" title={es.banner.twinLevelHint}>
            {es.banner.twinLevel[run.twin_level]}
          </span>
        )}
        {warnings.length > 0 && (
          <button type="button" className="link-button" onClick={() => setOpen(!open)}>
            {es.banner.warnings(warnings.length)} · {open ? es.banner.hide : es.banner.show}
          </button>
        )}
      </div>
      {open && (
        <ul className="data-banner-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
