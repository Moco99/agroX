import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { stageStatusOf } from "../../lib/farm-labels";
import { DataStateBadge } from "../../components/data-state-badge";
import { DataStateLegend } from "../../components/explain/data-state-legend";
import { HowCalculated } from "../../components/explain/how-calculated";
import { ModelNote } from "../../components/explain/model-note";
import { ReadingChip } from "../../components/explain/reading-chip";
import { Term } from "../../components/explain/term";
import { navigateTo } from "../../app-shell/sidebar";
import { es, fmt, fmtDate, fmtDateShort } from "../../i18n/es";
import { ndviReading } from "../../lib/readings";
import { analyzeSeason, compareWithPreviousYears, downsample, groupClearByZone, EVENT_LABELS, VEG_PARAMS, verdictText } from "../../lib/vegetation";
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

// Chart limits: a parcel can carry many zones and years of daily points; recharts freezes the tab past a few thousand dots
const MAX_CHART_ROWS = 200;
const MAX_CHART_ZONES = 6;
const NO_POINTS: ObservationPoint[] = [];
const NO_ZONES: { zone_id: string; name: string }[] = [];
const chartProps = { isAnimationActive: false, dot: false, connectNulls: true } as const;

export default function VegetationScreen() {
  const farm = useTwinStore((s) => s.farm);
  const sentinel2 = useTwinStore((s) => s.sentinel2);
  const modis = useTwinStore((s) => s.modis);
  const selectedZoneId = useTwinStore((s) => s.selectedZoneId);
  const selectZone = useTwinStore((s) => s.selectZone);
  const [zoneId, setZoneId] = useState<string | null>(null);

  const zones = farm?.farm.zones ?? NO_ZONES;
  const activeId = zoneId ?? selectedZoneId ?? zones[0]?.zone_id ?? "";
  // Sentinel-2 drives the analysis; MODIS (pilot only) is the fallback and a dashed context line
  const primary = sentinel2 && sentinel2.points.length > 0 ? sentinel2 : modis;
  const byZone = useMemo(() => groupClearByZone(primary?.points ?? NO_POINTS), [primary]);
  const modisByZone = useMemo(() => (primary === modis || !modis ? null : groupClearByZone(modis.points)), [primary, modis]);
  const points = byZone.get(activeId) ?? NO_POINTS;
  const modisPoints = modisByZone?.get(activeId) ?? NO_POINTS;
  // Active zone first, then the rest, capped so the chart stays responsive
  const chartZones = useMemo(
    () => [...zones].sort((a, b) => Number(b.zone_id === activeId) - Number(a.zone_id === activeId)).slice(0, MAX_CHART_ZONES),
    [zones, activeId],
  );
  const latestYear = Number((points.at(-1)?.date ?? "").slice(0, 4)) || null;
  const season = useMemo(() => (latestYear ? analyzeSeason(points, latestYear) : null), [points, latestYear]);
  const comparison = useMemo(() => compareWithPreviousYears(points), [points]);

  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, number | string>>();
    for (const z of chartZones) {
      for (const p of byZone.get(z.zone_id) ?? NO_POINTS) rows.set(p.date, { ...(rows.get(p.date) ?? { date: p.date }), [z.zone_id]: p.value });
    }
    for (const p of modisPoints) rows.set(p.date, { ...(rows.get(p.date) ?? { date: p.date }), modis: p.value });
    return downsample([...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), MAX_CHART_ROWS);
  }, [chartZones, byZone, modisPoints]);

  // Same-date view: one line per year over month-day, so seasons overlay
  const yearly = useMemo(() => {
    const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
    const rows = new Map<string, Record<string, number | string>>();
    for (const p of points) rows.set(p.date.slice(5), { ...(rows.get(p.date.slice(5)) ?? { md: p.date.slice(5) }), [p.date.slice(0, 4)]: p.value });
    return { years, rows: downsample([...rows.values()].sort((a, b) => String(a.md).localeCompare(String(b.md))), MAX_CHART_ROWS) };
  }, [points]);

  if (!farm) {
    return (
      <div className="module-screen">
        <header><h1>{es.vegetation.title}</h1></header>
        <div className="loading" role="status">{es.vegetation.loading}</div>
        <div className="card empty-state">
          <p>{es.states.noFarm}</p>
          <button type="button" className="ghost-button" onClick={() => navigateTo("globe")}>{es.states.goExplore}</button>
        </div>
      </div>
    );
  }
  const warnings = [...new Set([...(sentinel2?.warnings ?? []), ...(modis?.warnings ?? [])])];
  const active = zones.find((z) => z.zone_id === activeId);
  const ndviStage = stageStatusOf(farm, "ndvi");
  const ndviPending = ndviStage === "pending" || ndviStage === "running" || ndviStage === "loading";

  return (
    <div className="module-screen vegetation-screen">
      <header>
        <h1>{es.vegetation.title}</h1>
        <p className="muted">{es.vegetation.subtitle(farm.farm.name, Boolean(modis))}</p>
        <p className="meaning"><Term id="ndvi" />: {es.glossary.ndvi.text}</p>
      </header>
      <ModelNote withScore={false} compact />
      {!primary || primary.points.length === 0 ? (
        <div className="card empty-state" role="status">
          {/* While the NDVI stage is still downloading, say so instead of the generic empty message */}
          <p>{ndviPending ? es.vegetation.downloading : es.vegetation.empty}</p>
          <button type="button" className="ghost-button" onClick={() => navigateTo("map")}>{es.states.goExplore}</button>
          {warnings.length > 0 && <ul className="climate-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h3>{es.vegetation.current}</h3>
              <small className="muted">{es.vegetation.currentSub}</small>
            </div>
            <p className="meaning">{es.meaning.ndvi}</p>
            <div className="climate-kpis">
              {zones.map((z) => {
                const last = byZone.get(z.zone_id)?.at(-1);
                return (
                  <button key={z.zone_id} type="button" className={`climate-kpi veg-zone${z.zone_id === activeId ? " is-selected" : ""}`}
                    onClick={() => { setZoneId(z.zone_id); selectZone(z.zone_id); }} aria-pressed={z.zone_id === activeId}>
                    <small>{z.name}</small>
                    <strong><i className="veg-swatch" style={{ background: rampColor(NDVI_RAMP, last?.value ?? null) }} aria-hidden /> {fmt(last?.value ?? null, 2)}</strong>
                    {last && <ReadingChip reading={ndviReading(last.value)} />}
                    <small className="muted">{last ? `${fmtDate(last.date)} · ${primary.source_id}` : es.vegetation.noClear}</small>
                    <DataStateBadge state={primary.provenance.data_state} compact />
                  </button>
                );
              })}
            </div>
            <div className="veg-scale" aria-label={es.vegetation.scaleAria}>
              <span>{es.vegetation.scaleLow}</span>
              <i style={{ background: `linear-gradient(90deg, ${NDVI_RAMP.map((s) => s.hex).join(", ")})` }} />
              <span>{es.vegetation.scaleHigh}</span>
            </div>
            <div className="legend-classes" aria-hidden>{es.legend.ndvi.map((c) => <span key={c}>{c}</span>)}</div>
            <small className="muted">{es.reading.ndvi.note}</small>
            <HowCalculated id="ndvi" />
          </section>

          <section className="card">
            <h3>{es.vegetation.series}</h3>
            <p className="meaning">{es.vegetation.seriesHelp}</p>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={tick} minTickGap={40} />
                  <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={tick} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {chartZones.map((z, i) => <Line key={z.zone_id} {...chartProps} dataKey={z.zone_id} name={`${z.name} (${primary.source_id})`} stroke={ZONE_COLORS[i % ZONE_COLORS.length]} />)}
                  {modisPoints.length > 0 && <Line {...chartProps} dataKey="modis" name={`${active?.name ?? es.vegetation.zoneFallback} (${modis?.source_id})`} stroke={color.text.muted} strokeDasharray="4 3" />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="chart-note">
              {primary.source_id} · {primary.resolution_m} m <DataStateBadge state={primary.provenance.data_state} compact />
              {modis && primary !== modis && <> · MODIS {modis.resolution_m} m <DataStateBadge state={modis.provenance.data_state} compact /> {es.vegetation.modisContext}</>}
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h3><Term id="greenUp">{es.vegetation.events(active?.name ?? es.vegetation.zoneFallback)}</Term></h3>
              <DataStateBadge state="ESTIMATED" />
            </div>
            <p className="muted">
              {es.vegetation.eventsMethod(String(Math.round(VEG_PARAMS.amplitudeFraction * 100)), fmt(VEG_PARAMS.bareSoilMax, 2))}
            </p>
            {season && season.events.length > 0 ? (
              <ul className="veg-events">
                {season.events.map((e) => <li key={e.kind}><strong>{EVENT_LABELS[e.kind]}</strong>: {fmtDate(e.date)} · NDVI {fmt(e.value, 2)} <DataStateBadge state="ESTIMATED" compact /></li>)}
              </ul>
            ) : null}
            {season?.note && <p className="muted">{season.note}</p>}
            {season && season.bareSoil.length > 0 ? (
              <ul className="veg-events">
                {season.bareSoil.map((b) => <li key={b.start}><strong>{es.vegetation.bareSoil}</strong>: {b.start === b.end ? fmtDate(b.start) : es.vegetation.range(fmtDate(b.start), fmtDate(b.end))} ({es.vegetation.observations(b.observations)}) <DataStateBadge state="ESTIMATED" compact /></li>)}
              </ul>
            ) : season && !season.note && <p className="muted">{es.vegetation.noBare(season.year)}</p>}
          </section>

          <section className="card">
            <h3>{es.vegetation.compare}</h3>
            <p><strong>{verdictText(comparison)}</strong></p>
            {comparison && comparison.mean !== null && (
              <p className="muted">
                {es.vegetation.compareDetail(fmt(comparison.current, 2), fmtDate(comparison.currentDate), fmt(comparison.mean, 2), comparison.previous.map((p) => p.year).join(", "), VEG_PARAMS.sameDateWindowDays, fmt(VEG_PARAMS.usualBand, 2))} <DataStateBadge state="ESTIMATED" compact />
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
                    {yearly.years.map((y, i) => <Line key={y} {...chartProps} dataKey={y} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="card">
            <h3>{es.vegetation.sources}</h3>
            <p className="muted">
              {[sentinel2, modis].filter((s): s is ObservationSeries => Boolean(s)).map((s) => `${s.provenance.source} (${s.source_id}, ${s.resolution_m} m)`).join(" · ")}
            </p>
            {warnings.length > 0 && <ul className="climate-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <DataStateLegend />
          </section>
        </>
      )}
    </div>
  );
}
