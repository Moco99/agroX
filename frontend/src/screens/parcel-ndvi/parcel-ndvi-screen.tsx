import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataStateBadge } from "../../components/data-state-badge";
import { FarmMap2D } from "../../components/farm-map-2d";
import { LayerLegend } from "../../components/layer-legend";
import { es, fmt, fmtDate, fmtDateShort } from "../../i18n/es";
import { observedNdvi } from "../../lib/derive";
import { makeProjector } from "../../lib/geo";
import { useTwinStore } from "../../store/twin-store";
import { color, NDVI_RAMP, rampColor } from "../../styles/tokens";

// ─────────────────────────────────────────
// Section: S2 · Parcel with NDVI (Sentinel-2 overlay + zones + MODIS series)
// ─────────────────────────────────────────

const ZONE_COLORS = ["#7EE36D", "#F3B406", "#5AA9E6", "#F15F48"];

export function ParcelNdviScreen() {
  const farm = useTwinStore((s) => s.farm);
  const overlay = useTwinStore((s) => s.overlay);
  const modis = useTwinStore((s) => s.modis);
  const sentinel2 = useTwinStore((s) => s.sentinel2);
  const selectedZoneId = useTwinStore((s) => s.selectedZoneId);
  const selectZone = useTwinStore((s) => s.selectZone);
  const baseline = useTwinStore((s) => s.baseline);
  const dayIndex = useTwinStore((s) => s.dayIndex);
  const date = baseline?.zones[0]?.states[dayIndex]?.date ?? "9999-12-31";
  const [showOverlay, setShowOverlay] = useState(true);
  const projector = useMemo(() => (farm ? makeProjector(farm.farm) : null), [farm]);

  const series = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const p of modis?.points ?? []) {
      if (!p.zone_id) continue;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[p.zone_id] = p.value;
      byDate.set(p.date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [modis]);

  if (!farm || !projector) return null;
  const zones = farm.farm.zones;
  // Zone NDVI follows the timeline date: latest observation on or before it (Sentinel-2 preferred if as recent)
  const obsByZone = Object.fromEntries(zones.map((z) => [z.zone_id, observedNdvi(z.zone_id, date, [sentinel2, modis])]));
  const zoneStyles = Object.fromEntries(
    zones.map((z) => {
      const o = obsByZone[z.zone_id];
      const v = o?.point.value ?? null;
      return [
        z.zone_id,
        {
          fill: showOverlay && overlay ? "transparent" : rampColor(NDVI_RAMP, v),
          label: o ? `NDVI ${fmt(v, 2)} (${fmtDateShort(o.point.date)})` : "NDVI —",
        },
      ];
    }),
  );

  return (
    <div className="screen">
      <div className="canvas-area">
        <div className="canvas-tabs">
          <button type="button" className={showOverlay ? "is-active" : ""} onClick={() => setShowOverlay(true)} disabled={!overlay}>
            {es.parcel.overlay}
          </button>
          <button type="button" className={!showOverlay ? "is-active" : ""} onClick={() => setShowOverlay(false)}>
            {es.parcel.zones}
          </button>
        </div>
        <div className="canvas-stage" data-testid="parcel-map">
          <FarmMap2D
            farm={farm.farm}
            projector={projector}
            zoneStyles={zoneStyles}
            selectedZoneId={selectedZoneId}
            onSelect={selectZone}
            overlay={showOverlay ? overlay : null}
            zoneFillOpacity={showOverlay && overlay ? 0 : 0.8}
          />
        </div>
        {!overlay && <div className="canvas-notice">{es.parcel.noOverlay}</div>}
        <div className="canvas-legend">
          <LayerLegend
            layer="ndvi"
            note={
              overlay && showOverlay
                ? `${es.parcel.resolution(overlay.resolution_m, fmtDate(overlay.date))} · ${es.parcel.coverageNote}`
                : `${farm.latest_ndvi_source ?? ""} · ${fmtDate(farm.latest_ndvi_date)}`
            }
          />
        </div>
      </div>
      <aside className="panel">
        <div className="panel-head">
          <h2>{es.parcel.title}</h2>
          <small className="muted">
            {farm.farm.name} · {fmt(farm.farm.area_ha, 0)} ha · {fmt(farm.farm.centroid.lat, 4)}, {fmt(farm.farm.centroid.lon, 4)}
          </small>
        </div>
        <section className="card">
          <h3>{es.parcel.series}</h3>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={color.border.subtle} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 11, fill: color.text.muted }} minTickGap={40} />
                <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={{ fontSize: 11, fill: color.text.muted }} />
                <Tooltip contentStyle={{ background: color.bg.card, border: `1px solid ${color.border.subtle}`, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {zones.map((z, i) => (
                  <Line key={z.zone_id} dataKey={z.zone_id} name={z.name} stroke={ZONE_COLORS[i % ZONE_COLORS.length]} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-note">
            {modis?.source_id} · {modis?.resolution_m} m <DataStateBadge state={modis?.provenance.data_state ?? null} compact />{" "}
            {modis?.warnings.join(" · ")}
          </p>
          {sentinel2 && (
            <p className="chart-note">
              Sentinel-2: {sentinel2.points.filter((p) => p.zone_id === (selectedZoneId ?? zones[0]?.zone_id)).map((p) => `${fmtDateShort(p.date)} ${p.value.toFixed(2)}`).join(" · ")}
            </p>
          )}
        </section>
        {zones.map((z) => (
          <section key={z.zone_id} className={`card zone-card${selectedZoneId === z.zone_id ? " is-selected" : ""}`} onClick={() => selectZone(z.zone_id)}>
            <div className="card-head">
              <h3>
                {z.name} · {es.crops[z.crop_id] ?? z.crop_id} · {fmt(z.area_ha, 0)} ha
              </h3>
              <DataStateBadge state={z.data_state} compact />
            </div>
            <div className="kv">
              <span>{es.parcel.ndviLatest}</span>
              <strong>
                {fmt(obsByZone[z.zone_id]?.point.value ?? null, 2)}{" "}
                <small className="muted">
                  {obsByZone[z.zone_id]
                    ? `${fmtDate(obsByZone[z.zone_id]?.point.date)} · ${obsByZone[z.zone_id]?.series.source_id}`
                    : ""}
                </small>
              </strong>
              <span>{es.parcel.history}</span>
              <span className="chips">
                {z.cdl_history.map((h) => (
                  <span key={h.year} className="chip">
                    {h.year}: {es.crops[h.crop_id] ?? h.crop_id} ({Math.round(h.purity * 100)} %)
                  </span>
                ))}
              </span>
              <span>{es.parcel.soil}</span>
              <span>
                {z.soil.component_name} · {z.soil.texture} · {es.parcel.awc} {fmt(z.soil.awc_mm_per_m, 0)} mm/m · {es.parcel.hydgrp}{" "}
                {z.soil.hydrologic_group} · {es.parcel.drainage}: {z.soil.drainage_class}{" "}
                <DataStateBadge state={z.soil.provenance.data_state} compact />
              </span>
              <span>{es.parcel.terrain}</span>
              <span>
                {fmt(z.terrain.slope_mean_pct, 1)} % · {es.parcel.erosionLabel}: {es.parcel.erosion[z.terrain.erosion_index] ?? z.terrain.erosion_index}
              </span>
            </div>
          </section>
        ))}
      </aside>
    </div>
  );
}
