import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt, fmtDate } from "../../i18n/es";
import { cumulative, stressClassFor, type ZoneView } from "../../lib/derive";
import type { DataState, TwinConfig } from "../../types/api";

// ─────────────────────────────────────────
// Section: KPI tiles of the selected zone at the timeline date (each with data_state)
// ─────────────────────────────────────────

interface Tile {
  label: string;
  value: string;
  unit: string;
  state: DataState | null;
  note?: string;
  delta?: { value: number; unit: string; goodWhenUp: boolean } | null;
  accent?: string;
}

function Delta({ d }: { d: NonNullable<Tile["delta"]> }) {
  if (Math.abs(d.value) < 1e-6) return <span className="delta">= {es.kpi.vsBaseline}</span>;
  const up = d.value > 0;
  const good = up === d.goodWhenUp;
  return (
    <span className={`delta ${good ? "is-good" : "is-bad"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {fmt(d.value, 1)} {d.unit} {es.kpi.vsBaseline}
    </span>
  );
}

export function KpiTiles({
  view,
  hasScenario,
  config,
}: {
  view: ZoneView | null;
  hasScenario: boolean;
  config: TwinConfig | null;
}) {
  if (!view?.state) return null;
  const s = view.state;
  const b = view.baselineState;
  const idx = view.zone.states.indexOf(s);
  const precip = cumulative(view.zone.states, idx, "precip_mm");
  const tempState: DataState = s.data_state === "SIMULATED" ? "SIMULATED" : s.data_state === "SYNTHETIC" ? "SYNTHETIC" : "MEASURED";
  const tiles: Tile[] = [
    {
      label: es.kpi.ndvi,
      value: view.ndvi ? view.ndvi.value.toFixed(2) : "—",
      unit: "",
      state: view.ndviSource?.provenance.data_state ?? null,
      note: view.ndvi
        ? es.kpi.observedOn(fmtDate(view.ndvi.date), view.ndviSource?.source_id === "sentinel2" ? "Sentinel-2" : "MODIS")
        : es.kpi.noObservation,
    },
    {
      label: es.kpi.temperature,
      value: fmt(s.t_max, 1),
      unit: "°C",
      state: tempState,
      delta: hasScenario && b ? { value: s.t_max - b.t_max, unit: "°C", goodWhenUp: false } : null,
    },
    {
      label: es.kpi.precipitation,
      value: fmt(precip, 0),
      unit: "mm",
      state: tempState,
      delta: hasScenario && b ? { value: precip - cumulative(view.baselineStates, idx, "precip_mm"), unit: "mm", goodWhenUp: true } : null,
    },
    {
      label: es.kpi.soilMoisture,
      value: fmt(s.soil_water_fraction * 100, 0),
      unit: es.kpi.ofTaw,
      state: s.data_state,
      note: `${fmt(s.taw_mm - s.root_zone_depletion_mm, 0)} de ${fmt(s.taw_mm, 0)} mm`,
      delta: hasScenario && b ? { value: (s.soil_water_fraction - b.soil_water_fraction) * 100, unit: "pp", goodWhenUp: true } : null,
    },
    {
      label: es.kpi.stress,
      value: es.stressClass[stressClassFor(s.ks, config?.stress_class_thresholds_mean_ks ?? [])],
      unit: "",
      state: s.data_state,
      note: `Ks ${fmt(s.ks, 2)}`,
      delta: hasScenario && b ? { value: s.ks - b.ks, unit: "Ks", goodWhenUp: true } : null,
    },
  ];
  return (
    <div className="kpi-grid">
      {tiles.map((t) => (
        <div key={t.label} className="kpi" data-testid="kpi-tile">
          <div className="kpi-label">
            {t.label} <DataStateBadge state={t.state} compact />
          </div>
          <div className="kpi-value">
            {t.value} <small>{t.unit}</small>
          </div>
          {t.note && <div className="kpi-note">{t.note}</div>}
          {t.delta && <Delta d={t.delta} />}
        </div>
      ))}
    </div>
  );
}
