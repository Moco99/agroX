import { useState } from "react";
import { PointSearch } from "../point/point-search";
import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt } from "../../i18n/es";
import { EXPLORE_PLACES } from "../../lib/globe-view";
import { areaHa, canConfirm, canFinish } from "../../lib/draw";
import { isPilotFarm } from "../../lib/parcel";
import { useDrawStore } from "../../store/draw-store";
import { useMapStore } from "../../store/map-store";
import { openDrawn, openPilot, selectPilot } from "../../store/open-parcel";
import { useParcelStore } from "../../store/parcel-store";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import type { RegionMetric } from "../../types/api";
import { DeclarationPanel } from "./declaration-panel";
import { LoadProgress, ParcelClimate, ParcelNdvi, ParcelSoil, ParcelWarnings } from "./parcel-panels";

// ─────────────────────────────────────────
// Section: Draw your own parcel (any simple polygon; several polygons = several zones)
// ─────────────────────────────────────────

// Close enough to trace field edges over the satellite mosaic
const LOCATE_ZOOM = 16;

function DrawParcelCard() {
  const draw = useDrawStore();
  const capability = useParcelStore((s) => s.capability);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const total = draw.polygons.reduce((s, p) => s + areaHa(p), 0);
  const confirm = async () => {
    setSending(true);
    setError(null);
    const err = await openDrawn(draw.polygons);
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    draw.clear();
    draw.setActive(false);
  };
  // Flies to the browser position at a zoom that suits tracing a parcel, drops a marker and turns drawing on
  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoNote(es.drawParcel.geoUnsupported);
      return;
    }
    setLocating(true);
    setGeoNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setLocating(false);
        setGeoNote(es.drawParcel.located);
        useMapStore.getState().setLocated(point);
        useMapStore.getState().flyTo({ center: [point.lon, point.lat], zoom: LOCATE_ZOOM, bearing: 0, pitch: 0 });
        draw.setActive(true);
      },
      (err) => {
        setLocating(false);
        setGeoNote(
          err.code === err.PERMISSION_DENIED
            ? es.drawParcel.geoDenied
            : err.code === err.TIMEOUT
              ? es.drawParcel.geoTimeout
              : es.drawParcel.geoUnavailable,
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };
  return (
    <section className="card draw-parcel-card" data-testid="draw-parcel">
      <div className="card-icon-header">
        <span className="card-lead-icon" aria-hidden>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
            <path
              d="M13.8 3.6L16.4 6.2L6.6 16H4V13.4L13.8 3.6Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M12 5.4L14.6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <div className="card-icon-header-copy">
          <h3>{es.drawParcel.title}</h3>
          <p className="muted">{draw.active ? es.drawParcel.activeHint : es.drawParcel.hint}</p>
        </div>
      </div>
      <div className="draw-split-actions">
        <button type="button" className="ghost-button draw-action-btn" onClick={locate} disabled={locating}>
          <svg viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden>
            <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" />
            <path d="M9 2V4M9 14V16M2 9H4M14 9H16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>{locating ? es.drawParcel.locating : es.drawParcel.locate}</span>
        </button>
        <button
          type="button"
          className="ghost-button draw-action-btn"
          aria-pressed={draw.active}
          onClick={() => draw.setActive(!draw.active)}
        >
          <svg viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden>
            <rect x="4" y="4" width="10" height="10" stroke="currentColor" strokeWidth="1.3" />
            <rect x="2.6" y="2.6" width="2.8" height="2.8" fill="currentColor" />
            <rect x="12.6" y="2.6" width="2.8" height="2.8" fill="currentColor" />
            <rect x="2.6" y="12.6" width="2.8" height="2.8" fill="currentColor" />
            <rect x="12.6" y="12.6" width="2.8" height="2.8" fill="currentColor" />
          </svg>
          <span>{draw.active ? es.drawParcel.stop : es.drawParcel.start}</span>
        </button>
      </div>
      {geoNote && (
        <p className="coverage-note" role="status" data-testid="geo-note">
          {geoNote}
        </p>
      )}
      {(draw.active || draw.polygons.length > 0) && (
        <>
          <div className="panel-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={draw.undo}
              disabled={draw.current.length === 0 && draw.polygons.length === 0}
            >
              {es.drawParcel.undo}
            </button>
            <button type="button" className="ghost-button" onClick={draw.finish} disabled={!canFinish(draw)}>
              {es.drawParcel.finish}
            </button>
            <button type="button" className="ghost-button" onClick={draw.clear}>
              {es.drawParcel.clear}
            </button>
          </div>
          <small className="muted">
            {es.drawParcel.summary(draw.polygons.length, total, draw.current.length)} <DataStateBadge state="DECLARED" />
          </small>
          <button
            type="button"
            className="play-button wide-button"
            onClick={() => void confirm()}
            disabled={!canConfirm(draw) || sending || capability === "unsupported"}
          >
            {sending ? es.drawParcel.sending : es.drawParcel.confirm} ↗
          </button>
          {capability === "unsupported" && <p className="coverage-note is-warn">{es.openParcel.unsupported}</p>}
          {error && (
            <p className="coverage-note is-warn" role="alert">
              {es.drawParcel.failed(error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

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

// The globe panel's twin shortcut is the pilot's: make it the active parcel first so the twin shows Iowa
function openPilotTwin(): void {
  selectPilot();
  openTwin();
}

// ─────────────────────────────────────────
// Section: Globe stage panel (exploration anywhere + honest coverage)
// ─────────────────────────────────────────

export function GlobePanel() {
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const phase = useParcelStore((s) => s.phase);
  const farmId = useParcelStore((s) => s.farmId);
  return (
    <aside className="panel" aria-label={es.geo.title}>
      <div className="panel-head has-satellite">
        <div className="eyebrow-row">
          <span className="eyebrow">{es.geo.eyebrow}</span>
          <i className="eyebrow-line" aria-hidden />
        </div>
        <svg className="panel-satellite-art" viewBox="0 0 110 80" width="92" height="68" fill="none" aria-hidden>
          <g stroke="rgba(165, 205, 255, 0.72)" strokeWidth="1.1">
            {/* Left solar array */}
            <polygon points="8,16 38,31 31,42 2,27" fill="rgba(56, 130, 220, 0.16)" />
            <line x1="18" y1="21" x2="11" y2="32" />
            <line x1="28" y1="26" x2="21" y2="37" />
            <line x1="5" y1="21.5" x2="34.5" y2="36.5" />
            {/* Right solar array */}
            <polygon points="73,47 104,62 97,73 66,58" fill="rgba(56, 130, 220, 0.16)" />
            <line x1="83" y1="52" x2="76" y2="63" />
            <line x1="93" y1="57" x2="86" y2="68" />
            <line x1="69.5" y1="52.5" x2="100.5" y2="67.5" />
            {/* Central bus cylinder */}
            <polygon points="48,25 66,35 52,58 34,48" fill="rgba(18, 36, 68, 0.85)" stroke="rgba(210, 232, 255, 0.85)" strokeWidth="1.3" />
            <line x1="34.5" y1="36.5" x2="41" y2="39" />
            <line x1="59" y1="48" x2="69.5" y2="52.5" />
            {/* Nadir dish / sensor cone */}
            <ellipse cx="42" cy="54" rx="7" ry="4" transform="rotate(28 42 54)" fill="rgba(96, 165, 250, 0.25)" />
            <line x1="39" y1="57" x2="32" y2="68" stroke="rgba(96, 165, 250, 0.65)" strokeDasharray="2 2" />
          </g>
        </svg>
        <h2>{es.geo.title}</h2>
        <p className="muted">{es.geo.hint}</p>
      </div>

      <section className="card card-action-shell">
        <button
          type="button"
          className="action-row-button"
          aria-expanded={coordinatesOpen}
          onClick={() => setCoordinatesOpen((open) => !open)}
        >
          <span className="card-lead-icon" aria-hidden>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path
                d="M10 17.2C10 17.2 15.2 12.4 15.2 8.2C15.2 5.3 12.9 3 10 3C7.1 3 4.8 5.3 4.8 8.2C4.8 12.4 10 17.2 10 17.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="8.2" r="2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </span>
          <span className="action-row-title">{es.point.enterCoordinates}</span>
          <svg className="action-row-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {coordinatesOpen && <PointSearch onSubmit={() => setCoordinatesOpen(false)} />}
      </section>

      <DrawParcelCard />
      {phase !== "idle" && phase !== "ready" && !isPilotFarm(farmId) && <LoadProgress />}

      <section className="card pilot-card">
        <div className="card-icon-header is-clickable" onClick={openPilot}>
          <span className="card-lead-icon" aria-hidden>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path d="M10 3L17.5 7L10 11L2.5 7L10 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M2.5 10.5L10 14.5L17.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.5 14L10 18L17.5 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="card-icon-header-copy">
            <div className="pilot-card-title-row">
              <h3>{es.geo.pilotTitle}</h3>
              <svg className="action-row-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="muted">{es.geo.pilotHint}</p>
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="play-button wide-button" onClick={openPilot}>
            {es.geo.pilot} ↗
          </button>
          <button type="button" className="ghost-button" onClick={openPilotTwin}>
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
      {isPilotFarm(farmId) && (
        <section className="card">
          <h3>{es.geo.pilotMetrics}</h3>
          <SeasonMetrics withNdvi />
        </section>
      )}
      <p className="chart-note">{es.geo.resolution}</p>
    </aside>
  );
}

// ─────────────────────────────────────────
// Section: Farm (map) stage panel (mockup 13: farm, zones with measured NDVI, season conditions, CTA)
// ─────────────────────────────────────────

export function FarmPanel() {
  const farmId = useParcelStore((s) => s.farmId);
  const phase = useParcelStore((s) => s.phase);
  const farmResp = useTwinStore((s) => s.farm);
  const baseline = useTwinStore((s) => s.baseline);
  const farm = farmResp?.farm;
  const pilot = isPilotFarm(farmId);
  const zones = baseline?.zones ?? [];
  const place = pilot ? es.geo.farmPlace : farm ? `${farm.centroid.lat.toFixed(4)}, ${farm.centroid.lon.toFixed(4)}` : farmId;
  return (
    <aside className="panel" aria-label={es.geo.farmTitle}>
      <div className="panel-head">
        <div className="eyebrow-row">
          <span className="eyebrow">{es.stages.map.toUpperCase()}</span>
          <i className="eyebrow-line" aria-hidden />
        </div>
        <h2>{pilot ? (farm?.name ?? es.geo.farmTitle) : (farm?.name ?? farmId)}</h2>
        <p className="muted">
          {place}
          {farm ? ` · ${fmt(farm.area_ha, 1)} ha · ${es.geo.zones(farm.zones.length)}` : ""}
        </p>
      </div>
      {phase !== "ready" && <LoadProgress />}
      {!pilot && farmResp?.land_cover?.is_cropland === false && (
        <p className="coverage-note is-warn" role="alert" data-testid="not-crop">
          {es.openParcel.notCrop}
          {farmResp.land_cover.worldcover_2021 ? ` (${farmResp.land_cover.worldcover_2021})` : ""}
        </p>
      )}
      {!pilot && farm && <ParcelWarnings />}
      {pilot ? (
        <>
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
                      <strong>{z.ndvi === null ? "—" : fmt(z.ndvi, 2)}</strong> <DataStateBadge state={z.ndvi_state} compact />
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
        </>
      ) : (
        farm &&
        phase === "ready" && (
          <>
            <ParcelNdvi />
            <ParcelClimate />
            <ParcelSoil />
            <DeclarationPanel />
          </>
        )
      )}
      <p className="chart-note">{es.geo.coverage}</p>
      <button type="button" className="twin-cta" onClick={openTwin} disabled={!baseline}>
        <strong>{es.geo.cta} ↗</strong>
        <small>{es.geo.ctaSub}</small>
      </button>
    </aside>
  );
}
