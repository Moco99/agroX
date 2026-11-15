import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt, fmtDate } from "../../i18n/es";
import { isPilotFarm } from "../../lib/parcel";
import { cancelOpen, openPilot, retryActive } from "../../store/open-parcel";
import { SOURCE_KEYS, useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import { color } from "../../styles/tokens";
import type { DataState, FarmZone } from "../../types/api";

// ─────────────────────────────────────────
// Section: Load progress (first load of a new parcel takes 30–90 s: never a frozen screen)
// ─────────────────────────────────────────

const SPIN: Record<string, string> = { pending: "◌", ok: "✓", error: "✕", skipped: "–", idle: "·" };

export function LoadProgress() {
  const phase = useParcelStore((s) => s.phase);
  const sources = useParcelStore((s) => s.sources);
  const startedAt = useParcelStore((s) => s.startedAt);
  const farmId = useParcelStore((s) => s.farmId);
  const error = useTwinStore((s) => s.error);
  const stages = useTwinStore((s) => s.farm?.load_status?.stages) ?? [];
  const [now, setNow] = useState(() => Date.now());

  // One timer while loading so the elapsed counter proves the app is alive; cleared when the load ends
  useEffect(() => {
    if (phase !== "loading") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === "idle" || phase === "ready") return null;
  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const loading = phase === "loading";
  return (
    <section className={`card load-card is-${phase}`} role="status" aria-live="polite" data-testid="parcel-load">
      <h3>{loading ? es.openParcel.loadingTitle : phase === "cancelled" ? es.openParcel.cancelled : es.openParcel.failedTitle}</h3>
      {loading && (
        <>
          <p className="muted">{es.openParcel.loadingHint}</p>
          <div className="load-bar" aria-hidden>
            <i />
          </div>
          <small className="muted">{es.openParcel.elapsed(seconds)}</small>
        </>
      )}
      <ul className="load-sources">
        {SOURCE_KEYS.map((k) => {
          const st = sources[k];
          return (
            <li key={k} className={`is-${st.state}`}>
              <span className="load-icon" aria-hidden>
                {SPIN[st.state]}
              </span>
              <span>
                {es.openParcel.sources[k]}
                <small className="muted">
                  {" "}
                  · {st.state === "pending" && k !== "farm" && sources.farm.state !== "ok" ? es.openParcel.sourceState.idle : es.openParcel.sourceState[st.state]}
                </small>
                {st.state === "pending" && k !== "farm" && sources.farm.state !== "ok" && (
                  <span className="skeleton-line" aria-hidden />
                )}
                {k === "farm" && st.state === "pending" && stages.length > 0 && (
                  <small className="muted" data-testid="backend-stages">
                    {stages
                      .filter((x) => x.required)
                      .map((x) => `${es.openParcel.stageNames[x.stage] ?? x.stage}: ${es.openParcel.stageStatus[x.status] ?? x.status}`)
                      .join(" · ")}
                  </small>
                )}
                {st.message && st.state === "error" && <small className="load-error">{st.message}</small>}
                {st.state === "skipped" && <small className="muted">{es.openParcel.sourceSkippedNote}</small>}
              </span>
            </li>
          );
        })}
      </ul>
      {!loading && error && !SOURCE_KEYS.some((k) => sources[k].message === error) && <p className="load-error">{error}</p>}
      <div className="panel-actions">
        {loading ? (
          <button type="button" className="ghost-button" onClick={cancelOpen}>
            {es.openParcel.cancel}
          </button>
        ) : (
          <button type="button" className="play-button wide-button" onClick={retryActive}>
            {es.openParcel.retry}
          </button>
        )}
        {!isPilotFarm(farmId) && (
          <button type="button" className="ghost-button" onClick={openPilot}>
            {es.openParcel.backToPilot}
          </button>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// Section: Warnings (collapsible; the backend states what is approximate, declared or provisional)
// ─────────────────────────────────────────

export function ParcelWarnings() {
  const farm = useTwinStore((s) => s.farm);
  const baseline = useTwinStore((s) => s.baseline);
  const warnings = useMemo(() => {
    const all = [...(farm?.warnings ?? []), ...(farm?.farm.warnings ?? []), ...(baseline?.warnings ?? [])];
    return Array.from(new Set(all));
  }, [farm, baseline]);
  if (!farm) return null;
  return (
    <details className="card warnings-card" open={false}>
      <summary>
        <strong>{es.openParcel.warningsTitle(warnings.length + 1)}</strong>
      </summary>
      <ul className="data-banner-warnings">
        <li>{es.openParcel.approx}</li>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

// ─────────────────────────────────────────
// Section: NDVI by zone and date (Sentinel-2 series; nothing interpolated)
// ─────────────────────────────────────────

const ZONE_COLORS = ["#7EE36D", "#5FD0F0", "#F0C75F", "#C08CF0"];

export function ParcelNdvi() {
  const farmResp = useTwinStore((s) => s.farm);
  const farm = farmResp?.farm;
  const ndviStage = farmResp?.load_status?.stages.find((x) => x.stage === "ndvi")?.status;
  const series = useTwinStore((s) => s.sentinel2);
  const date = useTwinStore((s) => s.ndviDate);
  const zones = farm?.zones ?? [];

  const { rows, latest } = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    const last: Record<string, { date: string; value: number }> = {};
    for (const p of series?.points ?? []) {
      if (!p.zone_id) continue;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[p.zone_id] = p.value;
      byDate.set(p.date, row);
      if (date ? p.date <= date : true) {
        const cur = last[p.zone_id];
        if (!cur || p.date > cur.date) last[p.zone_id] = { date: p.date, value: p.value };
      }
    }
    return { rows: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), latest: last };
  }, [series, date]);

  return (
    <section className="card">
      <h3>{es.openParcel.ndviTitle}</h3>
      {rows.length === 0 ? (
        <p className="muted">
          {ndviStage === "running" || ndviStage === "pending" ? es.openParcel.ndviLoading : es.openParcel.ndviNone}
        </p>
      ) : (
        <>
          {date && <small className="muted">{es.openParcel.ndviAt(fmtDate(date))}</small>}
          <ul className="zone-ndvi-list">
            {zones.map((z, i) => {
              const obs = latest[z.zone_id];
              return (
                <li key={z.zone_id}>
                  <span>
                    <i className="zone-dot" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} aria-hidden /> {z.name}
                  </span>
                  <span>
                    <strong>{obs ? fmt(obs.value, 2) : "—"}</strong> <DataStateBadge state="MEASURED" compact />
                    {obs && <small className="muted"> {obs.date}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mini-chart" aria-label={es.openParcel.ndviChart} role="img">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: color.text.secondary }} minTickGap={40} tickFormatter={(d: string) => d.slice(0, 7)} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: color.text.secondary }} />
                <Tooltip contentStyle={{ background: color.bg.panel, border: `1px solid ${color.border.subtle}`, fontSize: 11 }} />
                {zones.map((z, i) => (
                  <Line key={z.zone_id} type="monotone" dataKey={z.zone_id} name={z.name} stroke={ZONE_COLORS[i % ZONE_COLORS.length]} dot={false} strokeWidth={1.4} connectNulls />
                ))}
                {date && <ReferenceLine x={date} stroke="#ffffff88" />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <small className="muted">{es.openParcel.sourceLabel}: Sentinel-2 L2A · 10 m</small>
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────
// Section: Climate of the point (NASA POWER) over the simulation window
// ─────────────────────────────────────────

export function ParcelClimate() {
  const climate = useTwinStore((s) => s.climate);
  const span = useTwinStore((s) => s.span);
  const summary = useMemo(() => {
    const days = climate?.series.days ?? [];
    if (days.length === 0) return null;
    const precip = days.reduce((a, d) => a + d.precip, 0);
    const tmean = days.reduce((a, d) => a + d.t_mean, 0) / days.length;
    return { precip, tmean };
  }, [climate]);
  const state: DataState = climate?.series.provenance.data_state ?? "MEASURED";
  return (
    <section className="card">
      <h3>{es.openParcel.climateTitle}</h3>
      {summary ? (
        <>
          <div className="regional-metrics">
            <div>
              <small>{es.openParcel.precipTotal}</small>
              <strong>
                {fmt(summary.precip, 0)} <small>mm</small>
              </strong>
              <DataStateBadge state={state} compact />
            </div>
            <div>
              <small>{es.openParcel.tempMean}</small>
              <strong>
                {fmt(summary.tmean, 1)} <small>°C</small>
              </strong>
              <DataStateBadge state={state} compact />
            </div>
          </div>
          <small className="muted">
            {es.openParcel.climateWindow(fmtDate(span.start), fmtDate(span.end))} · {climate?.series.provenance.source}
          </small>
        </>
      ) : (
        <p className="muted">{es.openParcel.climateNone}</p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────
// Section: Soil with its provenance (SoilGrids is slow and may fail: provisional values are flagged)
// ─────────────────────────────────────────

function isProvisional(z: FarmZone): boolean {
  // The backend words its fallback note with "provisional" (SoilGrids unavailable -> generic AWC)
  return (
    z.soil.provenance.data_state === "ESTIMATED" &&
    (/provisional/i.test(z.soil.provenance.source) || z.soil.warnings.some((w) => /provisional/i.test(w)))
  );
}

export function ParcelSoil() {
  const farm = useTwinStore((s) => s.farm)?.farm;
  const sources = useParcelStore((s) => s.sources);
  const refresh = useTwinStore((s) => s.refreshFarm);
  const first = farm?.zones[0];
  if (!farm || !first) return null;
  const provisional = farm.zones.some(isProvisional);
  const retrying = sources.farm.state === "pending";
  return (
    <section className="card">
      <h3>{es.openParcel.soilTitle}</h3>
      <div className="regional-metrics">
        <div>
          <small>{es.openParcel.soilAwc}</small>
          <strong>
            {fmt(first.soil.awc_mm_per_m, 0)} <small>mm/m</small>
          </strong>
          <DataStateBadge state={first.soil.provenance.data_state} compact />
        </div>
        <div>
          <small>{es.openParcel.sourceLabel}</small>
          <strong>{first.soil.provenance.source}</strong>
        </div>
      </div>
      {provisional ? (
        <>
          <p className="coverage-note">{es.openParcel.soilProvisional}</p>
          <button type="button" className="ghost-button" disabled={retrying} onClick={() => void refresh()}>
            {retrying ? es.openParcel.soilRetrying : es.openParcel.soilRetry}
          </button>
        </>
      ) : (
        <small className="muted">{es.openParcel.soilReal}</small>
      )}
    </section>
  );
}
