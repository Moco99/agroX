import { es, fmtDate } from "../../i18n/es";
import { DEFAULT_CONTROLS, useTwinStore } from "../../store/twin-store";
import type { IrrigationLevel } from "../../types/api";

// ─────────────────────────────────────────
// Section: Scenario controls (presets + sliders + irrigation), posted to /api/twin/simulate
// ─────────────────────────────────────────

const LEVELS: IrrigationLevel[] = ["NONE", "LOW", "MEDIUM", "HIGH"];

export function SimulationPanel() {
  const controls = useTwinStore((s) => s.controls);
  const config = useTwinStore((s) => s.config);
  const setControls = useTwinStore((s) => s.setControls);
  const applyPreset = useTwinStore((s) => s.applyPreset);
  const simulating = useTwinStore((s) => s.simulating);
  const baseline = useTwinStore((s) => s.baseline);
  const dayIndex = useTwinStore((s) => s.dayIndex);
  const currentDate = baseline?.zones[0]?.states[dayIndex]?.date;
  const presets = Object.keys(config?.presets ?? {});

  return (
    <section className="card">
      <div className="card-head">
        <h3>{es.twin.conditions}</h3>
        {simulating && <span className="muted">{es.twin.simulating}</span>}
      </div>
      <label className="field">
        <span>{es.twin.scenario}</span>
        <select value={controls.preset} onChange={(e) => applyPreset(e.target.value)}>
          {controls.preset === "custom" && <option value="custom">{es.twin.presets.custom}</option>}
          {presets.map((p) => (
            <option key={p} value={p} title={config?.presets[p]?.description}>
              {es.twin.presets[p] ?? p}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          {es.twin.precipReduction}: <strong>{controls.precipPct > 0 ? "+" : ""}{controls.precipPct} %</strong>
        </span>
        <input
          type="range"
          min={-80}
          max={50}
          step={5}
          value={controls.precipPct}
          onChange={(e) => setControls({ precipPct: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>
          {es.twin.tempIncrease}: <strong>{controls.tempDelta > 0 ? "+" : ""}{controls.tempDelta.toFixed(1)} °C</strong>
        </span>
        <input
          type="range"
          min={-3}
          max={5}
          step={0.5}
          value={controls.tempDelta}
          onChange={(e) => setControls({ tempDelta: Number(e.target.value) })}
        />
      </label>
      <div className="field">
        <span>{es.twin.irrigation}</span>
        <div className="segmented" role="radiogroup">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={controls.irrigation === l}
              className={controls.irrigation === l ? "is-active" : ""}
              onClick={() => setControls({ irrigation: l })}
              title={
                config ? `${config.irrigation_levels[l].depth_mm} mm cuando el agotamiento supera ${config.irrigation_levels[l].trigger_fraction_of_raw}×RAW` : ""
              }
            >
              {es.irrigation[l]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{es.twin.forkFrom}</span>
        <div className="segmented">
          <button
            type="button"
            className={!controls.forkFromCurrent ? "is-active" : ""}
            onClick={() => setControls({ forkFromCurrent: false })}
          >
            {es.twin.forkWhole}
          </button>
          <button
            type="button"
            className={controls.forkFromCurrent ? "is-active" : ""}
            onClick={() => setControls({ forkFromCurrent: true })}
          >
            {es.twin.forkCurrent} ({fmtDate(currentDate)})
          </button>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={controls.monteCarlo}
          onChange={(e) => setControls({ monteCarlo: e.target.checked })}
        />
        {es.twin.monteCarlo}
      </label>
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          setControls(DEFAULT_CONTROLS);
          applyPreset("baseline");
        }}
      >
        {es.twin.reset}
      </button>
    </section>
  );
}
