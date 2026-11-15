import { useState } from "react";
import { PointSearch } from "../point/point-search";
import { DataStateBadge } from "../../components/data-state-badge";
import { ReadingChip } from "../../components/explain/reading-chip";
import { Term, type GlossaryTermId } from "../../components/explain/term";
import { ndviReading } from "../../lib/readings";
import { es, fmt } from "../../i18n/es";
import { EXPLORE_PLACES } from "../../lib/globe-view";
import { areaHa, canConfirm, canFinish, overlapsExisting } from "../../lib/draw";
import { locateMe, type LocateError } from "../../lib/geolocate";
import { isPilotFarm } from "../../lib/parcel";
import { useDrawStore } from "../../store/draw-store";
import { useMapStore } from "../../store/map-store";
import { openDrawn, openPilot, selectPilot } from "../../store/open-parcel";
import { useParcelStore } from "../../store/parcel-store";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import type { RegionMetric } from "../../types/api";
import { DeclarationPanel } from "./declaration-panel";
import { MyParcels } from "./my-parcels";
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
  const [coordinateFallback, setCoordinateFallback] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
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
    setLocating(true);
    setGeoNote(null);
    setGeoFailed(false);
    locateMe().then(
      (point) => {
        setLocating(false);
        setGeoNote(es.drawParcel.located);
        useMapStore.getState().setLocated(point);
        useMapStore.getState().flyTo({ center: [point.lon, point.lat], zoom: LOCATE_ZOOM, bearing: 0, pitch: 0 });
        draw.setActive(true);
      },
      (code: LocateError) => {
        setLocating(false);
        setGeoFailed(true);
        setGeoNote(
          code === "unsupported"
            ? es.drawParcel.geoUnsupported
            : code === "denied"
              ? es.drawParcel.geoDenied
              : code === "timeout"
                ? es.drawParcel.geoTimeout
                : es.drawParcel.geoUnavailable,
        );
      },
    );
  };
  return (
    <section className="card draw-parcel-card" data-testid="draw-parcel">
      <div className="card-icon-header">
        <span className="card-plain-icon" aria-hidden>
          <svg viewBox="0 0 22 22" width="20" height="20" fill="none">
            <path
              d="M15.2 3.8L18.2 6.8L7.4 17.6H4.4V14.6L15.2 3.8Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M13.2 5.8L16.2 8.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M3.5 19.2H18.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          </svg>
        </span>
        <div className="card-icon-header-copy">
          <h3>{es.drawParcel.title}</h3>
          <p className="muted">{draw.active ? es.drawParcel.activeHint : es.drawParcel.hint}</p>
        </div>
      </div>
      <div className="draw-split-actions">
        <button type="button" className="ghost-button draw-action-btn" onClick={locate} disabled={locating}>
          <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden>
            <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.35" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" />
            <path d="M9 1.8V4M9 14V16.2M1.8 9H4M14 9H16.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </svg>
          <span>{locating ? es.drawParcel.locating : es.drawParcel.locate}</span>
        </button>
        <button
          type="button"
          className="ghost-button draw-action-btn"
          aria-pressed={draw.active}
          onClick={() => draw.setActive(!draw.active)}
        >
          <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden>
            <rect x="4.2" y="4.2" width="9.6" height="9.6" stroke="currentColor" strokeWidth="1.3" />
            <rect x="2.6" y="2.6" width="2.8" height="2.8" rx="0.5" fill="#07101f" stroke="currentColor" strokeWidth="1.2" />
            <rect x="12.6" y="2.6" width="2.8" height="2.8" rx="0.5" fill="#07101f" stroke="currentColor" strokeWidth="1.2" />
            <rect x="2.6" y="12.6" width="2.8" height="2.8" rx="0.5" fill="#07101f" stroke="currentColor" strokeWidth="1.2" />
            <rect x="12.6" y="12.6" width="2.8" height="2.8" rx="0.5" fill="#07101f" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>{draw.active ? es.drawParcel.stop : es.drawParcel.start}</span>
        </button>
      </div>
      {geoNote && (
        <div className="coverage-note" role="status" data-testid="geo-note">
          <p>{geoNote}</p>
          {geoFailed && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setCoordinateFallback((open) => !open)}
              aria-expanded={coordinateFallback}
            >
              {es.drawParcel.enterCoordinates}
            </button>
          )}
          {geoFailed && coordinateFallback && <PointSearch onSubmit={() => setCoordinateFallback(false)} />}
        </div>
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
          {overlapsExisting(draw) && <p className="coverage-note is-warn" role="alert">{es.drawParcel.overlap}</p>}
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
  return unit === "index" ? es.units.index : unit;
}

// One labelled figure with its provenance badge; null values render as "—" instead of a made-up number
function Metric({ name, item, term, meaning }: { name: string; item: RegionMetric | undefined; term?: GlossaryTermId; meaning?: string }) {
  if (!item) return null;
  return (
    <div title={meaning}>
      <small>{term ? <Term id={term}>{name}</Term> : name}</small>
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
        {withNdvi && <Metric name={es.globe.ndvi} item={region.ndvi} term="ndvi" meaning={es.meaning.ndvi} />}
        <Metric name={es.globe.precipitation} item={region.precipitation} term="power" meaning={es.meaning.precipTotal} />
        <Metric name={es.globe.temperature} item={region.temperature} meaning={es.meaning.tMean} />
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
          <span className="card-plain-icon" aria-hidden>
            <svg viewBox="0 0 22 22" width="20" height="20" fill="none">
              <path
                d="M11 19C11 19 16.8 13.8 16.8 9C16.8 5.8 14.2 3.2 11 3.2C7.8 3.2 5.2 5.8 5.2 9C5.2 13.8 11 19 11 19Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="11" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" />
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
      <MyParcels />
      {phase !== "idle" && phase !== "ready" && !isPilotFarm(farmId) && <LoadProgress />}

      <section className="card pilot-card">
        <button type="button" className="pilot-card-button" onClick={openPilot}>
          <span className="card-plain-icon" aria-hidden>
            <svg viewBox="0 0 22 22" width="21" height="21" fill="none">
              <path d="M11 3.2L19.2 7.5L11 11.8L2.8 7.5L11 3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M2.8 11.2L11 15.5L19.2 11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.8 14.8L11 19.1L19.2 14.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
        </button>
        <div className="pilot-card-subactions">
          <button type="button" className="pilot-sublink" onClick={openPilotTwin}>
            {es.geo.twin} ↗
          </button>
        </div>
      </section>

      <details className="orbital-more">
        <summary>{es.geo.places} e indicadores</summary>
        <div className="orbital-more-body">
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
        </div>
      </details>
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
            <h3>
              <Term id="ndvi">{es.geo.zoneNdvi}</Term>
            </h3>
            <p className="meaning">{es.meaning.ndvi}</p>
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
                      {z.ndvi !== null && <ReadingChip reading={ndviReading(z.ndvi)} />} <DataStateBadge state={z.ndvi_state} compact />
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
