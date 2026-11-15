import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt } from "../../i18n/es";
import { anomalyExplanation, metricOf, spiExplanation, windowError } from "../../lib/climate-view";
import { isPilotFarm, parseParcelId } from "../../lib/parcel";
import { api } from "../../services/api";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import { color } from "../../styles/tokens";
import type { ClimateResponse } from "../../types/api";

// ─────────────────────────────────────────
// Section: Clima module (daily series + period indicators from GET /api/climate; nothing computed here)
// ─────────────────────────────────────────

const INDICATOR_KEYS = ["precip_total", "t_mean", "gdd_total", "et0_total", "frost_days", "hot_days"] as const;
const tooltipStyle = { background: color.bg.panel, border: `1px solid ${color.border.subtle}`, fontSize: 11 };
const tick = { fontSize: 9, fill: color.text.secondary };

export function ClimateView({ data }: { data: ClimateResponse }) {
  const ind = data.indicators;
  const anomaly = metricOf(ind, "precip_anomaly_pct");
  const spi = metricOf(ind, "spi");
  const days = data.series.days;
  const warnings = [...new Set([...data.warnings, ...data.series.warnings])];
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
            return (
              <div className="climate-kpi" key={key}>
                <small>{es.climateModule.labels[key]}</small>
                <strong>
                  {fmt(m?.value, key.endsWith("_days") ? 0 : 1)} <small>{m?.unit ?? ""}</small>
                </strong>
                <DataStateBadge state={m?.data_state ?? null} compact />
                {m?.source && <small className="muted">{m.source}</small>}
              </div>
            );
          })}
        </div>
      </section>
      <section className="card">
        <h3>{es.climateModule.interpretation}</h3>
        <div className="climate-kpis">
          <div className="climate-kpi">
            <small>{es.climateModule.anomaly}</small>
            <strong>{anomaly?.value == null ? "—" : `${fmt(anomaly.value, 1)} %`}</strong>
            <DataStateBadge state={anomaly?.data_state ?? null} compact />
          </div>
          <div className="climate-kpi">
            <small>{es.climateModule.spi}</small>
            <strong>{fmt(spi?.value, 2)}</strong>
            <DataStateBadge state={spi?.data_state ?? null} compact />
          </div>
        </div>
        <p>{anomalyExplanation(anomaly?.value ?? null)}</p>
        <p>{spiExplanation(spi?.value ?? null)}</p>
      </section>
      <section className="card">
        <h3>{es.climateModule.precipChart}</h3>
        <div role="img" aria-label={es.climateModule.precipChart}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={days} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={tick} minTickGap={40} />
              <YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="precip" name="Precipitación (mm)" fill={color.state.info} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card">
        <h3>{es.climateModule.tempChart}</h3>
        <div role="img" aria-label={es.climateModule.tempChart}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={days} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={tick} minTickGap={40} />
              <YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="t_max" name="Máxima" stroke={color.state.down} dot={false} strokeWidth={1.2} isAnimationActive={false} />
              <Line dataKey="t_mean" name="Media" stroke={color.accent.bright} dot={false} strokeWidth={1.4} isAnimationActive={false} />
              <Line dataKey="t_min" name="Mínima" stroke={color.state.info} dot={false} strokeWidth={1.2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <small className="muted">
        {es.climateModule.method}: {data.methodology}
      </small>
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
      .then((r) => !ctrl.signal.aborted && setData(r))
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
      {loading && <div className="loading">{es.climateModule.loading}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      {data && !loading && <ClimateView data={data} />}
    </div>
  );
}
