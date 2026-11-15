import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowCalculated, type FormulaId } from "../../components/explain/how-calculated";
import { es, fmt, fmtDateShort } from "../../i18n/es";
import { color } from "../../styles/tokens";
import type { ObservationSeries, ZoneResult } from "../../types/api";

// ─────────────────────────────────────────
// Section: Charts of the selected zone (backend outputs only; nothing is computed here)
// ─────────────────────────────────────────

type ChartKey = "soil" | "ks" | "gdd" | "ndvi" | "smap";
const KEYS: ChartKey[] = ["soil", "ks", "gdd", "ndvi", "smap"];
const LABELS: Record<ChartKey, string> = es.chartHelp.tabs;
// Each chart explains itself in one sentence and links to the white-box formula behind its line
const HOW: Partial<Record<ChartKey, FormulaId>> = { soil: "waterBalance", ks: "ks", gdd: "gdd", ndvi: "ndvi" };

interface Props {
  baseZone: ZoneResult;
  scenZone: ZoneResult | null;
  modis: ObservationSeries | null;
  sentinel2: ObservationSeries | null;
  smap: ObservationSeries | null;
  currentDate: string | undefined;
  depletionFraction: number | null;
}

type Row = Record<string, number | string | null>;

const axisStyle = { fontSize: 11, fill: color.text.muted };

export function TwinCharts({ baseZone, scenZone, modis, sentinel2, smap, currentDate, depletionFraction }: Props) {
  const [key, setKey] = useState<ChartKey>("soil");

  const rows = useMemo<Row[]>(() => {
    const byDate = new Map<string, Row>();
    const canopy = new Map(baseZone.expected_canopy.map((p) => [p.date, p.value]));
    baseZone.states.forEach((s, i) => {
      const sc = scenZone?.states[i];
      byDate.set(s.date, {
        date: s.date,
        swf: Math.round(s.soil_water_fraction * 1000) / 10,
        swf_s: sc ? Math.round(sc.soil_water_fraction * 1000) / 10 : null,
        ks: s.ks,
        ks_s: sc ? sc.ks : null,
        gdd: s.gdd_cum,
        gdd_s: sc ? sc.gdd_cum : null,
        canopy: canopy.get(s.date) ?? null,
        modis: null,
        s2: null,
        smap: null,
      });
    });
    const put = (series: ObservationSeries | null, field: string, zoneOnly: boolean) => {
      for (const p of series?.points ?? []) {
        if (zoneOnly && p.zone_id !== baseZone.zone_id) continue;
        const row = byDate.get(p.date);
        if (row) row[field] = p.value;
      }
    };
    put(modis, "modis", true);
    put(sentinel2, "s2", true);
    put(smap, "smap", false);
    return Array.from(byDate.values());
  }, [baseZone, scenZone, modis, sentinel2, smap]);

  const hasScenario = scenZone !== null;
  const stages = baseZone.summary.stage_dates;
  const ndviMetrics = baseZone.comparison.filter((c) => c.variable === "ndvi_shape");
  const smapMetric = baseZone.comparison.find((c) => c.source_id === "smap");

  const common = (
    <>
      <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
      <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={axisStyle} minTickGap={40} />
      <Tooltip
        contentStyle={{ background: color.bg.card, border: `1px solid ${color.border.subtle}`, fontSize: 12 }}
        labelFormatter={(l) => fmtDateShort(String(l))}
      />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {currentDate && <ReferenceLine x={currentDate} stroke={color.accent.bright} strokeDasharray="4 2" />}
    </>
  );

  return (
    <section className="card">
      <div className="chart-tabs" role="tablist">
        {KEYS.map((k) => (
          <button key={k} type="button" role="tab" className={k === key ? "is-active" : ""} onClick={() => setKey(k)}>
            {LABELS[k]}
          </button>
        ))}
      </div>
      <h4 className="chart-title">
        {key === "soil" && es.charts.soilWater}
        {key === "ks" && es.charts.ks}
        {key === "gdd" && es.charts.gdd}
        {key === "ndvi" && es.charts.ndvi}
        {key === "smap" && es.charts.smap}
      </h4>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            {common}
            {key === "soil" && (
              <>
                <YAxis domain={[0, 100]} tick={axisStyle} />
                {depletionFraction !== null && (
                  <ReferenceLine
                    y={(1 - depletionFraction) * 100}
                    stroke={color.state.warn}
                    strokeDasharray="6 3"
                    label={{ value: es.charts.threshold, fill: color.state.warn, fontSize: 10, position: "insideBottomLeft" }}
                  />
                )}
                <Line dataKey="swf" name={es.charts.baseline} stroke={color.state.info} dot={false} strokeWidth={2} />
                {hasScenario && <Line dataKey="swf_s" name={es.charts.scenario} stroke={color.state.down} dot={false} strokeWidth={2} />}
              </>
            )}
            {key === "ks" && (
              <>
                <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={axisStyle} />
                <Line dataKey="ks" name={es.charts.baseline} stroke={color.accent.bright} dot={false} strokeWidth={2} />
                {hasScenario && <Line dataKey="ks_s" name={es.charts.scenario} stroke={color.state.down} dot={false} strokeWidth={2} />}
              </>
            )}
            {key === "gdd" && (
              <>
                <YAxis tick={axisStyle} />
                {[stages.planting, stages.development, stages.mid_season, stages.late_season, stages.maturity].map(
                  (d, i) =>
                    d && (
                      <ReferenceLine
                        key={d}
                        x={d}
                        stroke={color.text.muted}
                        strokeDasharray="2 2"
                        label={{
                          value: [
                            es.timeline.stages.INITIAL,
                            es.timeline.stages.DEVELOPMENT,
                            es.timeline.stages.MID_SEASON,
                            es.timeline.stages.LATE_SEASON,
                            es.timeline.stages.HARVESTED,
                          ][i],
                          fill: color.text.secondary,
                          fontSize: 9,
                          position: "insideTopLeft",
                        }}
                      />
                    ),
                )}
                <Line dataKey="gdd" name={es.charts.baseline} stroke={color.state.warn} dot={false} strokeWidth={2} />
                {hasScenario && <Line dataKey="gdd_s" name={es.charts.scenario} stroke={color.state.down} dot={false} strokeWidth={2} />}
              </>
            )}
            {key === "ndvi" && (
              <>
                <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={axisStyle} />
                <Line dataKey="canopy" name={es.charts.expected} stroke={color.text.muted} dot={false} strokeDasharray="5 3" />
                <Line dataKey="modis" name={es.charts.modis} stroke={color.accent.bright} connectNulls dot={{ r: 3 }} />
                <Line dataKey="s2" name={es.charts.s2} stroke={color.state.warn} connectNulls dot={{ r: 3 }} />
              </>
            )}
            {key === "smap" && (
              <>
                <YAxis yAxisId="l" domain={[0, 0.5]} tick={axisStyle} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={axisStyle} />
                <Line yAxisId="l" dataKey="smap" name={es.charts.smapSeries} stroke={color.state.info} connectNulls={false} dot={{ r: 2 }} strokeWidth={0} />
                <Line yAxisId="r" dataKey="swf" name={es.charts.simulated} stroke={color.accent.soft} dot={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="meaning" data-testid="chart-meaning">
        {es.chartHelp[key]}
        {hasScenario && key !== "ndvi" && key !== "smap" && ` ${es.chartHelp.compare}`}
      </p>
      {HOW[key] && <HowCalculated id={HOW[key]} />}
      {key === "ndvi" && (
        <p className="chart-note">
          {es.charts.ndviNote} {es.chartHelp.metrics}
          {ndviMetrics.map((m) => (
            <span key={m.source_id} className="metric-line">
              {es.charts.metrics(m.source_id, m.n_points, fmt(m.correlation, 2), m.lag_days === null ? "—" : `${m.lag_days} d`)}
            </span>
          ))}
        </p>
      )}
      {key === "smap" && (
        <p className="chart-note">
          {es.charts.smapNote}
          {smapMetric && (
            <span className="metric-line">{es.charts.metrics("smap", smapMetric.n_points, fmt(smapMetric.correlation, 2), "—")}</span>
          )}
        </p>
      )}
    </section>
  );
}
