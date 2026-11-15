import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataStateBadge } from "../../components/data-state-badge";
import { DataStateLegend } from "../../components/explain/data-state-legend";
import { ExplainedMetric } from "../../components/explain/explained-metric";
import type { FormulaId } from "../../components/explain/how-calculated";
import { ModelNote } from "../../components/explain/model-note";
import { Term, type GlossaryTermId } from "../../components/explain/term";
import { es, fmt } from "../../i18n/es";
import { anomalyExplanation, metricOf, numberOf, spiExplanation, unitSymbol, windowError } from "../../lib/climate-view";
import { anomalyReading, spiReading } from "../../lib/readings";
import { isPilotFarm, parseParcelId } from "../../lib/parcel";
import { api } from "../../services/api";
import { useModuleView } from "../../store/module-store";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import { color } from "../../styles/tokens";
import type { ClimateResponse } from "../../types/api";

// ─────────────────────────────────────────
// Section: Clima module (daily series + period indicators from GET /api/climate; nothing computed here)
// ─────────────────────────────────────────

const INDICATOR_KEYS = ["precip_total", "t_mean", "gdd_total", "et0_total", "frost_days", "hot_days"] as const;
type IndicatorKey = (typeof INDICATOR_KEYS)[number];

// Plain meaning, spelled unit, glossary term and white-box formula of each indicator
const INDICATOR_HELP: Record<IndicatorKey, { unitLong: string; term?: GlossaryTermId; how?: FormulaId }> = {
  precip_total: { unitLong: es.units.mm },
  t_mean: { unitLong: es.units.celsius },
  gdd_total: { unitLong: es.units.gdd, term: "gdd", how: "gddClimate" },
  et0_total: { unitLong: es.units.mm, term: "et0", how: "et0" },
  frost_days: { unitLong: es.units.days },
  hot_days: { unitLong: es.units.days },
};

function meaningOf(key: IndicatorKey, hotThreshold: number | null): string {
  switch (key) {
    case "precip_total":
      return es.meaning.precipTotal;
    case "t_mean":
      return es.meaning.tMean;
    case "gdd_total":
      return es.meaning.gddTotal;
    case "et0_total":
      return es.meaning.et0Total;
    case "frost_days":
      return es.meaning.frostDays;
    case "hot_days":
      return hotThreshold === null ? es.meaning.hotDaysNoThreshold : es.meaning.hotDays(fmt(hotThreshold, 0));
  }
}
const tooltipStyle = { background: color.bg.panel, border: `1px solid ${color.border.subtle}`, fontSize: 11 };
const tick = { fontSize: 9, fill: color.text.secondary };

export function ClimateView({ data }: { data: ClimateResponse }) {
  const ind = data.indicators;
  const anomaly = metricOf(ind, "precip_anomaly_pct");
  const spi = metricOf(ind, "spi");
  const days = data.series.days;
  const warnings = [...new Set([...data.warnings, ...data.series.warnings])];
  const gddBase = numberOf(ind, "gdd_base_c");
  const hotThreshold = numberOf(ind, "hot_threshold_c");
  const methodology = es.methodology[data.methodology] ?? data.methodology;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>{es.climateModule.indicators}</h3>
          <small className="muted">
            {es.climateModule.source}: {data.series.provenance.source} <DataStateBadge state={data.series.provenance.data_state} compact />
          </small>
        </div>
        <div className="climate-kpis">
          {INDICATOR_KEYS.map((key) => {
            const m = metricOf(ind, key);
            const help = INDICATOR_HELP[key];
            const label = es.climateModule.labels[key];
            return (
              <ExplainedMetric
                key={key}
                className="climate-kpi"
                testId="climate-kpi"
                label={help.term ? <Term id={help.term}>{label}</Term> : label}
                value={fmt(m?.value, key.endsWith("_days") ? 0 : 1)}
                unit={unitSymbol(m?.unit)}
                unitLong={help.unitLong}
                state={m?.data_state ?? null}
                meaning={meaningOf(key, hotThreshold)}
                note={m?.source ?? undefined}
                how={help.how}
                howCurrent={key === "gdd_total" && gddBase !== null ? `T base = ${fmt(gddBase, 1)} °C` : null}
              />
            );
          })}
        </div>
      </section>
      <section className="card">
        <h3>{es.climateModule.interpretation}</h3>
        <div className="climate-kpis">
          <ExplainedMetric
            className="climate-kpi"
            label={<Term id="anomaly">{es.climateModule.anomaly}</Term>}
            value={anomaly?.value == null ? "—" : `${anomaly.value > 0 ? "+" : ""}${fmt(anomaly.value, 1)}`}
            unit={anomaly?.value == null ? "" : "%"}
            unitLong={es.units.pct}
            state={anomaly?.data_state ?? null}
            reading={anomalyReading(anomaly?.value ?? null)}
            meaning={es.meaning.anomaly}
            how="anomaly"
          />
          <ExplainedMetric
            className="climate-kpi"
            label={<Term id="spi">{es.climateModule.spi}</Term>}
            value={fmt(spi?.value, 2)}
            unitLong={es.units.index}
            state={spi?.data_state ?? null}
            reading={spiReading(spi?.value ?? null)}
            meaning={es.meaning.spi}
            how="spi"
          />
        </div>
        <p className="meaning">{anomalyExplanation(anomaly?.value ?? null)}</p>
        <p className="meaning">{spiExplanation(spi?.value ?? null)}</p>
      </section>
      {days.length === 0 && <p className="muted" role="status">{es.climateHelp.empty}</p>}
      {days.length > 0 && (
        <>
          <section className="card">
            <h3>{es.climateModule.precipChart}</h3>
            <p className="meaning">{es.climateHelp.precipChart}</p>
            <div role="img" aria-label={es.climateModule.precipChart}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={days} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={tick} minTickGap={40} />
                  <YAxis tick={tick} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="precip" name={es.climateHelp.precipSeries} fill={color.state.info} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card">
            <h3>{es.climateModule.tempChart}</h3>
            <p className="meaning">{es.climateHelp.tempChart}</p>
            <div role="img" aria-label={es.climateModule.tempChart}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={days} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={tick} minTickGap={40} />
                  <YAxis tick={tick} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="t_max" name={es.climateHelp.max} stroke={color.state.down} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                  <Line dataKey="t_mean" name={es.climateHelp.mean} stroke={color.accent.bright} dot={false} strokeWidth={1.4} isAnimationActive={false} />
                  <Line dataKey="t_min" name={es.climateHelp.min} stroke={color.state.info} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
      <small className="muted">
        {es.climateModule.method}: {methodology}
      </small>
      <DataStateLegend />
      {warnings.length > 0 && (
        <ul className="climate-warnings" role="status">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ClimateScreen() {
  const farmId = useParcelStore((s) => s.farmId);
  const span = useTwinStore((s) => s.span);
  const [start, setStart] = useState(span.start);
  const [end, setEnd] = useState(span.end);
  const [applied, setApplied] = useState({ start: span.start, end: span.end });
  const [data, setData] = useState<ClimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const invalid = windowError(start, end);

  useEffect(() => {
    const point = parseParcelId(farmId);
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const where = isPilotFarm(farmId) || !point ? { farmId } : { lat: point.lat, lon: point.lon };
    api
      .climate(where, applied.start, applied.end, ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setData(r);
        useModuleView.getState().setClimate({ farmId, data: r });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [farmId, applied]);

  return (
    <div className="module-screen climate-screen">
      <header>
        <h1>{es.climateModule.title}</h1>
        <p className="muted">{es.climateModule.subtitle}</p>
      </header>
      <ModelNote withScore={false} compact />
      <form
        className="module-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) setApplied({ start, end });
        }}
      >
        <label>
          {es.climateModule.start}
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          {es.climateModule.end}
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button type="submit" className="ghost-button" disabled={invalid !== null || loading}>
          {es.climateModule.apply}
        </button>
      </form>
      {invalid && <p className="error-box" role="alert">{invalid}</p>}
      {loading && (
        <div className="loading" role="status">
          {es.climateModule.loading} <small className="muted">{es.climateHelp.loadingHint}</small>
        </div>
      )}
      {error && (
        <div className="error-box empty-state" role="alert">
          <strong>{es.climateHelp.errorTitle}</strong>
          <span>{error}</span>
          <span>{es.states.errorHint}</span>
          <button type="button" className="ghost-button" onClick={() => setApplied({ ...applied })}>
            {es.states.retry}
          </button>
        </div>
      )}
      {data && !loading && <ClimateView data={data} />}
    </div>
  );
}
