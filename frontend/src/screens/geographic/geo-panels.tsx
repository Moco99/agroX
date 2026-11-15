import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt } from "../../i18n/es";
import { defaultPointRange, EXPLORE_PLACES, insideBounds } from "../../lib/globe-view";
import { useMapStore } from "../../store/map-store";
import { usePointStore } from "../../store/point-store";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import type { RegionMetric } from "../../types/api";

// ─────────────────────────────────────────
// Section: Shared bits
// ─────────────────────────────────────────

function unitLabel(unit: string): string {
  return unit === "index" ? "índice" : unit;
}

// One labelled figure with its provenance badge; null values render as "—" instead of a made-up number
function Metric({ name, item }: { name: string; item: RegionMetric | undefined }) {
  if (!item) return null;
  return (
    <div>
      <small>{name}</small>
      <strong>
        {item.value === null ? "—" : fmt(item.value, 2)} <small>{unitLabel(item.unit)}</small>
      </strong>
      <small className="muted" title={item.source ?? undefined}>
        <DataStateBadge state={item.data_state} compact />
      </small>
    </div>
  );
}

function SeasonMetrics({ withNdvi }: { withNdvi: boolean }) {
  const region = useTwinStore((s) => s.region);
  if (!region) return <p className="muted">{es.globe.loadingRegion}</p>;
  return (
    <>
      <div className="regional-metrics">
        {withNdvi && <Metric name={es.globe.ndvi} item={region.ndvi} />}
        <Metric name={es.globe.precipitation} item={region.precipitation} />
        <Metric name={es.globe.temperature} item={region.temperature} />
        <Metric name={es.globe.radiation} item={region.radiation} />
      </div>
      <small className="muted">
        {region.region_name} · {region.period_start} — {region.period_end}
      </small>
    </>
  );
}

function openTwin(): void {
  useStageStore.getState().goTo("twin");
}

// ─────────────────────────────────────────
// Section: Globe stage panel (exploration anywhere + honest coverage)
// ─────────────────────────────────────────

export function GlobePanel() {
  const selected = useMapStore((s) => s.selected);
  const meta = useTwinStore((s) => s.imageryMeta);
  const pointLoading = usePointStore((s) => s.loading);
  const inPilot = selected && meta ? insideBounds(selected, meta.bounds) : false;
  const analyze = () => {
    if (!selected) return;
    void usePointStore.getState().query({ ...selected, ...defaultPointRange() });
  };
  return (
    <aside className="panel" aria-label={es.geo.title}>
      <div className="panel-head">
        <span className="eyebrow">{es.geo.eyebrow}</span>
        <h2>{es.geo.title}</h2>
        <p className="muted">{es.geo.hint}</p>
      </div>
      <section className="card">
        <h3>{es.geo.selected}</h3>
        {selected ? (
          <>
            <p className="selected-coordinates">
              {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
            </p>
            <p className={inPilot ? "coverage-note is-in" : "coverage-note"}>
              {inPilot ? es.geo.insidePilot : es.geo.outsidePilot}
            </p>
            <button type="button" className="play-button wide-button" onClick={analyze} disabled={pointLoading}>
              {es.geo.analyze}
            </button>
            <small className="muted">{es.geo.analyzeHint}</small>
          </>
        ) : (
          <p className="muted">{es.geo.choose}</p>
        )}
      </section>
      <section className="card">
        <h3>{es.geo.pilotTitle}</h3>
        <p className="muted">{es.geo.pilotHint}</p>
        <div className="panel-actions">
          <button type="button" className="play-button wide-button" onClick={() => useMapStore.getState().flyTo("pilot")}>
            {es.geo.pilot} ↗
          </button>
          <button type="button" className="ghost-button" onClick={openTwin}>
            {es.geo.twin}
          </button>
        </div>
      </section>
      <section className="card">
        <h3>{es.geo.places}</h3>
        <p className="muted">{es.geo.placesHint}</p>
        <div className="place-list">
          {EXPLORE_PLACES.map((p) => (
            <button key={p.id} type="button" className="ghost-button" onClick={() => useMapStore.getState().flyTo(p.view)}>
              {es.geo.place[p.id]}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>{es.geo.pilotMetrics}</h3>
        <SeasonMetrics withNdvi />
      </section>
      <p className="chart-note">{es.geo.resolution}</p>
    </aside>
  );
}

// ─────────────────────────────────────────
// Section: Farm (map) stage panel (mockup 13: farm, zones with measured NDVI, season conditions, CTA)
// ─────────────────────────────────────────

export function FarmPanel() {
  const farmResp = useTwinStore((s) => s.farm);
  const baseline = useTwinStore((s) => s.baseline);
  const farm = farmResp?.farm;
  const zones = baseline?.zones ?? [];
  return (
    <aside className="panel" aria-label={es.geo.farmTitle}>
      <div className="panel-head">
        <span className="eyebrow">{es.stages.map.toUpperCase()}</span>
        <h2>{farm?.name ?? es.geo.farmTitle}</h2>
        <p className="muted">
          {es.geo.farmPlace}
          {farm ? ` · ${fmt(farm.area_ha, 1)} ha · ${es.geo.zones(farm.zones.length)}` : ""}
        </p>
      </div>
      <section className="card">
        <h3>{es.geo.zoneNdvi}</h3>
        {zones.some((z) => z.ndvi !== null) ? (
          <ul className="zone-ndvi-list">
            {zones.map((z) => (
              <li key={z.zone_id}>
                <span>
                  {z.name}
                  <small className="muted"> · {es.crops[z.crop_id] ?? z.crop_id}</small>
                </span>
                <span>
                  <strong>{z.ndvi === null ? "—" : fmt(z.ndvi, 2)}</strong>{" "}
                  <DataStateBadge state={z.ndvi_state} compact />
                  {z.ndvi_date && <small className="muted"> {z.ndvi_date}</small>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{es.geo.noZoneNdvi}</p>
        )}
      </section>
      <section className="card">
        <h3>{es.geo.season}</h3>
        <SeasonMetrics withNdvi={false} />
      </section>
      <p className="chart-note">{es.geo.coverage}</p>
      <button type="button" className="twin-cta" onClick={openTwin}>
        <strong>{es.geo.cta} ↗</strong>
        <small>{es.geo.ctaSub}</small>
      </button>
    </aside>
  );
}
