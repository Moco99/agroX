import { ExplainedMetric } from "../../components/explain/explained-metric";
import { Term } from "../../components/explain/term";
import { es, fmt, fmtDate } from "../../i18n/es";
import { cumulative, stressClassFor, type ZoneView } from "../../lib/derive";
import { deltaReading, ndviReading, soilWaterReading, stressReading } from "../../lib/readings";
import type { DataState, TwinConfig } from "../../types/api";

// ─────────────────────────────────────────
// Section: KPI tiles of the selected zone at the timeline date (each with data_state, meaning and reading)
// ─────────────────────────────────────────

interface Delta {
  value: number;
  unit: string;
  goodWhenUp: boolean;
}

// The delta keeps its arrow and number, and adds the verdict word so "▼ −12" is never left to interpretation
function DeltaLine({ d }: { d: Delta }) {
  const reading = deltaReading(d.value, d.goodWhenUp);
  if (reading.tone === "neutral") return <span className="delta">= {es.kpi.vsBaseline}</span>;
  const up = d.value > 0;
  return (
    <span className={`delta ${reading.tone === "good" ? "is-good" : "is-bad"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {fmt(d.value, 1)} {d.unit} {es.kpi.vsBaseline} · {reading.label}
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
  const cls = stressClassFor(s.ks, config?.stress_class_thresholds_mean_ks ?? []);
  // p (RAW / TAW) comes from the crop catalogue through the engine; never assumed here
  const p = s.taw_mm > 0 ? s.raw_mm / s.taw_mm : null;
  const left = s.taw_mm - s.root_zone_depletion_mm;
  const ndviSource = view.ndviSource?.source_id === "sentinel2" ? "Sentinel-2" : "MODIS";

  return (
    <div className="kpi-grid">
      <ExplainedMetric
        testId="kpi-tile"
        label={es.twin.soilWater}
        value={fmt(s.soil_water_fraction * 100, 0)}
        unit="%"
        unitLong={es.units.pctTaw}
        state={s.data_state}
        reading={soilWaterReading(s.soil_water_fraction, p, cls)}
        meaning={es.meaning.soilWater}
        note={es.twinCopy.waterLeft(fmt(left, 0), fmt(s.taw_mm, 0))}
        how="waterBalance"
        howCurrent={`(${fmt(s.taw_mm, 0)} − ${fmt(s.root_zone_depletion_mm, 0)}) ÷ ${fmt(s.taw_mm, 0)} = ${fmt(s.soil_water_fraction * 100, 0)} %`}
      >
        {hasScenario && b && <DeltaLine d={{ value: (s.soil_water_fraction - b.soil_water_fraction) * 100, unit: "pp", goodWhenUp: true }} />}
      </ExplainedMetric>
      <ExplainedMetric
        testId="kpi-tile"
        label={<Term id="stress">{es.kpi.stress}</Term>}
        value={fmt(s.ks, 2)}
        unit="Ks"
        unitLong={es.units.ks}
        state={s.data_state}
        reading={stressReading(cls)}
        meaning={es.meaning.stress}
        note={<Term id="ks" />}
        how="ks"
        howCurrent={p === null ? null : `p = ${fmt(p, 2)} · Ks = ${fmt(s.ks, 2)}`}
      >
        {hasScenario && b && <DeltaLine d={{ value: s.ks - b.ks, unit: "Ks", goodWhenUp: true }} />}
      </ExplainedMetric>
      <ExplainedMetric
        testId="kpi-tile"
        label={<Term id="ndvi">{es.kpi.ndvi}</Term>}
        value={view.ndvi ? fmt(view.ndvi.value, 2) : "—"}
        unitLong={es.units.ndvi}
        state={view.ndviSource?.provenance.data_state ?? null}
        reading={view.ndvi ? ndviReading(view.ndvi.value) : null}
        meaning={es.meaning.ndvi}
        note={view.ndvi ? es.kpi.observedOn(fmtDate(view.ndvi.date), ndviSource) : es.kpi.noObservation}
        how="ndvi"
      />
      <ExplainedMetric
        testId="kpi-tile"
        label={es.kpi.temperature}
        value={fmt(s.t_max, 1)}
        unit="°C"
        unitLong={es.units.celsius}
        state={tempState}
        reading={{ tone: "neutral", label: es.reading.temperature }}
        meaning={es.meaning.temperatureMax}
      >
        {hasScenario && b && <DeltaLine d={{ value: s.t_max - b.t_max, unit: "°C", goodWhenUp: false }} />}
      </ExplainedMetric>
      <ExplainedMetric
        testId="kpi-tile"
        label={es.kpi.precipitation}
        value={fmt(precip, 0)}
        unit="mm"
        unitLong={es.units.mm}
        state={tempState}
        reading={{ tone: "neutral", label: es.reading.precipitation }}
        meaning={es.meaning.precipitation}
      >
        {hasScenario && b && (
          <DeltaLine d={{ value: precip - cumulative(view.baselineStates, idx, "precip_mm"), unit: "mm", goodWhenUp: true }} />
        )}
      </ExplainedMetric>
    </div>
  );
}

