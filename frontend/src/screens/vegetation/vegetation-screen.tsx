import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataStateBadge } from "../../components/data-state-badge";
import { fmt, fmtDate, fmtDateShort } from "../../i18n/es";
import { analyzeSeason, clearPoints, compareWithPreviousYears, EVENT_LABELS, VEG_PARAMS, verdictText } from "../../lib/vegetation";
import { useTwinStore } from "../../store/twin-store";
import { color, NDVI_RAMP, rampColor } from "../../styles/tokens";
import type { ObservationPoint, ObservationSeries } from "../../types/api";

// ─────────────────────────────────────────
// Section: Vegetación module (NDVI per zone from the observation endpoints; season events are estimates)
// ─────────────────────────────────────────

const ZONE_COLORS = ["#7EE36D", "#F3B406", "#5AA9E6", "#F15F48"];
const YEAR_COLORS = ["#7EE36D", "#5AA9E6", "#F3B406", "#C08CF0", "#F15F48"];
const tooltipStyle = { background: color.bg.card, border: `1px solid ${color.border.subtle}`, fontSize: 12 };
const tick = { fontSize: 11, fill: color.text.muted };

function zonePoints(series: ObservationSeries | null, zoneId: string): ObservationPoint[] {
  return clearPoints((series?.points ?? []).filter((p) => p.zone_id === zoneId));
}

export default function VegetationScreen() {
  const farm = useTwinStore((s) => s.farm);
  const sentinel2 = useTwinStore((s) => s.sentinel2);
  const modis = useTwinStore((s) => s.modis);
  const selectedZoneId = useTwinStore((s) => s.selectedZoneId);
  const selectZone = useTwinStore((s) => s.selectZone);
  const [zoneId, setZoneId] = useState<string | null>(null);

  const zones = farm?.farm.zones ?? [];
  const activeId = zoneId ?? selectedZoneId ?? zones[0]?.zone_id ?? "";
  // Sentinel-2 drives the analysis; MODIS (pilot only) is the fallback and a dashed context line
  const primary = sentinel2 && sentinel2.points.length > 0 ? sentinel2 : modis;
  const points = useMemo(() => zonePoints(primary, activeId), [primary, activeId]);
  const modisPoints = useMemo(() => (primary === modis ? [] : zonePoints(modis, activeId)), [primary, modis, activeId]);
  const latestYear = Number((points.at(-1)?.date ?? "").slice(0, 4)) || null;
  const season = useMemo(() => (latestYear ? analyzeSeason(points, latestYear) : null), [points, latestYear]);
  const comparison = useMemo(() => compareWithPreviousYears(points), [points]);

  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, number | string>>();
    for (const z of zones) {
      for (const p of zonePoints(primary, z.zone_id)) rows.set(p.date, { ...(rows.get(p.date) ?? { date: p.date }), [z.zone_id]: p.value });
    }
    for (const p of modisPoints) rows.set(p.date, { ...(rows.get(p.date) ?? { date: p.date }), modis: p.value });
    return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [zones, primary, modisPoints]);

  // Same-date view: one line per year over month-day, so seasons overlay
  const yearly = useMemo(() => {
    const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
    const rows = new Map<string, Record<string, number | string>>();
    for (const p of points) rows.set(p.date.slice(5), { ...(rows.get(p.date.slice(5)) ?? { md: p.date.slice(5) }), [p.date.slice(0, 4)]: p.value });
    return { years, rows: [...rows.values()].sort((a, b) => String(a.md).localeCompare(String(b.md))) };
  }, [points]);

  if (!farm) {
    return (
      <div className="module-screen">
        <header><h1>Vegetación de la parcela</h1></header>
        <div className="loading">Cargando la parcela…</div>
      </div>
    );
  }
  const warnings = [...new Set([...(sentinel2?.warnings ?? []), ...(modis?.warnings ?? [])])];
  const active = zones.find((z) => z.zone_id === activeId);

  return (
    <div className="module-screen vegetation-screen">
      <header>
        <h1>Vegetación de la parcela</h1>
        <p className="muted">{farm.farm.name} · NDVI por zona (Sentinel-2{modis ? " y MODIS" : ""}). Las observaciones nubladas se descartan cuando la fuente informa su fracción válida.</p>
      </header>
      {!primary || primary.points.length === 0 ? (
        <div className="card">
          <p>Todavía no hay observaciones de NDVI para esta parcela. Si se está descargando, vuelve en unos minutos.</p>
          {warnings.length > 0 && <ul className="climate-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h3>NDVI actual por zona</h3>
              <small className="muted">última observación clara de cada zona</small>
            </div>
            <div className="climate-kpis">
              {zones.map((z) => {
                const last = zonePoints(primary, z.zone_id).at(-1);
                return (
                  <button key={z.zone_id} type="button" className={`climate-kpi veg-zone${z.zone_id === activeId ? " is-selected" : ""}`}
                    onClick={() => { setZoneId(z.zone_id); selectZone(z.zone_id); }} aria-pressed={z.zone_id === activeId}>
                    <small>{z.name}</small>
                    <strong><i className="veg-swatch" style={{ background: rampColor(NDVI_RAMP, last?.value ?? null) }} aria-hidden /> {fmt(last?.value ?? null, 2)}</strong>
                    <small className="muted">{last ? `${fmtDate(last.date)} · ${primary.source_id}` : "Sin observación clara"}</small>
                    <DataStateBadge state={primary.provenance.data_state} compact />
                  </button>
                );
              })}
            </div>
            <div className="veg-scale" aria-label="Escala de color NDVI">
              <span>0,2 o menos</span>
              <i style={{ background: `linear-gradient(90deg, ${NDVI_RAMP.map((s) => s.hex).join(", ")})` }} />
              <span>0,8 o más</span>
            </div>
          </section>

          <section className="card">
            <h3>Serie de NDVI</h3>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={tick} minTickGap={40} />
                  <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={tick} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {zones.map((z, i) => <Line key={z.zone_id} dataKey={z.zone_id} name={`${z.name} (${primary.source_id})`} stroke={ZONE_COLORS[i % ZONE_COLORS.length]} dot={{ r: 2 }} connectNulls />)}
                  {modisPoints.length > 0 && <Line dataKey="modis" name={`${active?.name ?? "Zona"} (${modis?.source_id})`} stroke={color.text.muted} strokeDasharray="4 3" dot={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="chart-note">
              {primary.source_id} · {primary.resolution_m} m <DataStateBadge state={primary.provenance.data_state} compact />
              {modis && primary !== modis && <> · MODIS {modis.resolution_m} m <DataStateBadge state={modis.provenance.data_state} compact /> (solo contexto: pocos píxeles por zona)</>}
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Eventos de temporada · {active?.name}</h3>
              <DataStateBadge state="ESTIMATED" />
            </div>
            <p className="muted">
              Estimados a partir de la serie, no observados en campo. Método: máximo = observación más alta del año; inicio de verdor y de senescencia = fecha en que el NDVI cruza el {Math.round(VEG_PARAMS.amplitudeFraction * 100)} % de la amplitud (mínimo a máximo) antes y después del máximo, interpolada entre observaciones; suelo desnudo = observaciones con NDVI de {fmt(VEG_PARAMS.bareSoilMax, 2)} o menos. Los umbrales son parámetros de producto, no valores agronómicos validados.
            </p>
            {season && season.events.length > 0 ? (
              <ul className="veg-events">
                {season.events.map((e) => <li key={e.kind}><strong>{EVENT_LABELS[e.kind]}</strong>: {fmtDate(e.date)} · NDVI {fmt(e.value, 2)} <DataStateBadge state="ESTIMATED" compact /></li>)}
              </ul>
            ) : null}
            {season?.note && <p className="muted">{season.note}</p>}
            {season && season.bareSoil.length > 0 ? (
              <ul className="veg-events">
                {season.bareSoil.map((b) => <li key={b.start}><strong>Posible suelo desnudo</strong>: {b.start === b.end ? fmtDate(b.start) : `${fmtDate(b.start)} a ${fmtDate(b.end)}`} ({b.observations} {b.observations === 1 ? "observación" : "observaciones"}) <DataStateBadge state="ESTIMATED" compact /></li>)}
              </ul>
            ) : season && !season.note && <p className="muted">No se detectaron observaciones de suelo desnudo en {season.year}.</p>}
          </section>

          <section className="card">
            <h3>Comparación con años anteriores</h3>
            <p><strong>{verdictText(comparison)}</strong></p>
            {comparison && comparison.mean !== null && (
              <p className="muted">
                Hoy {fmt(comparison.current, 2)} ({fmtDate(comparison.currentDate)}) frente a un promedio de {fmt(comparison.mean, 2)} en {comparison.previous.map((p) => p.year).join(", ")}. Se usa la observación más cercana a la misma fecha (±{VEG_PARAMS.sameDateWindowDays} días); el margen de "usual" es ±{fmt(VEG_PARAMS.usualBand, 2)} de NDVI (parámetro de producto). <DataStateBadge state="ESTIMATED" compact />
              </p>
            )}
            {yearly.years.length > 1 && (
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={yearly.rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                    <XAxis dataKey="md" tickFormatter={(v: string) => fmtDateShort(`2000-${v}`)} tick={tick} minTickGap={40} />
                    <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={tick} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDateShort(`2000-${String(v)}`)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {yearly.years.map((y, i) => <Line key={y} dataKey={y} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} dot={{ r: 2 }} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="card">
            <h3>Fuentes y avisos</h3>
            <p className="muted">
              {[sentinel2, modis].filter((s): s is ObservationSeries => Boolean(s)).map((s) => `${s.provenance.source} (${s.source_id}, ${s.resolution_m} m)`).join(" · ")}
            </p>
            {warnings.length > 0 && <ul className="climate-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
