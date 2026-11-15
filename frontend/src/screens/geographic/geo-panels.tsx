import { useState } from "react";
import { PointSearch } from "../point/point-search";
import { sameQueriedPoint } from "../../lib/coordinates";
import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt } from "../../i18n/es";
import { defaultPointRange, EXPLORE_PLACES, insideBounds, PILOT_BOUNDS } from "../../lib/globe-view";
import { isPilotFarm, parcelIdFromPoint } from "../../lib/parcel";
import { useMapStore } from "../../store/map-store";
import { canOpenAt, openParcelAt, openPilot, selectPilot } from "../../store/open-parcel";
import { useParcelStore } from "../../store/parcel-store";
import { usePointStore } from "../../store/point-store";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import type { RegionMetric } from "../../types/api";
import { DeclarationPanel } from "./declaration-panel";
import { LoadProgress, ParcelClimate, ParcelNdvi, ParcelSoil, ParcelWarnings } from "./parcel-panels";

// Coverage verdict of the point query for the selected point; null until a matching query answered
function coverageVerdict(
  result: ReturnType<typeof usePointStore.getState>["result"],
  selected: { lat: number; lon: number },
): boolean | null {
  if (!result) return null;
  if (!sameQueriedPoint(result.point, selected)) return null;
  const data = result.sections.coverage.data;
  const flag = data?.es_cultivo;
  return typeof flag === "boolean" ? flag : null;
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
  const selected = useMapStore((s) => s.selected);
  const pointLoading = usePointStore((s) => s.loading);
  const pointResult = usePointStore((s) => s.result);
  const capability = useParcelStore((s) => s.capability);
  const phase = useParcelStore((s) => s.phase);
  const farmId = useParcelStore((s) => s.farmId);
  const inPilot = selected ? insideBounds(selected, PILOT_BOUNDS) : false;
  const analyze = () => {
    if (!selected) return;
    void usePointStore.getState().query({ ...selected, ...defaultPointRange() });
  };
  // Re-evaluated on every render so a late /api/health answer updates the button and its note
  const verdict = selected && !inPilot ? canOpenAt(selected) : null;
  const crop = selected ? coverageVerdict(pointResult, selected) : null;
  const note =
    verdict && !verdict.ok
      ? verdict.reason === "latitude-south"
        ? es.openParcel.latSouth
        : verdict.reason === "latitude-north"
          ? es.openParcel.latNorth
          : verdict.reason === "unsupported"
            ? es.openParcel.unsupported
            : es.openParcel.invalid
      : null;
  // Only the parcel already loading blocks its own button; choosing another one cancels the load in flight
  const loadingNow = phase === "loading";
  const busy = loadingNow && (inPilot ? isPilotFarm(farmId) : verdict?.ok === true && verdict.farmId === farmId);
  return (
    <aside className="panel" aria-label={es.geo.title}>
      <div className="panel-head">
        <span className="eyebrow">{es.geo.eyebrow}</span>
        <h2>{es.geo.title}</h2>
        <p className="muted">{es.geo.hint}</p>
      </div>
      <section className="card">
        <button type="button" className="ghost-button wide-button" aria-expanded={coordinatesOpen}
          onClick={() => setCoordinatesOpen((open) => !open)}>{es.point.enterCoordinates}</button>
        {coordinatesOpen && <PointSearch onSubmit={() => setCoordinatesOpen(false)} />}
      </section>
      <section className="card" data-testid="selected-point">
        <h3>{es.geo.selected}</h3>
        {selected ? (
          <>
            <p className="selected-coordinates">
              {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
            </p>
            <p className={inPilot ? "coverage-note is-in" : "coverage-note"}>
              {inPilot ? es.geo.insidePilot : es.geo.outsidePilot}
            </p>
            {inPilot ? (
              <button type="button" className="play-button wide-button" onClick={openPilot} disabled={busy}>
                {es.openParcel.openPilot}
              </button>
            ) : (
              <>
                {verdict?.ok && (
                  <small className="muted">
                    {es.openParcel.parcelId}: <code>{parcelIdFromPoint(selected)}</code>
                  </small>
                )}
                {capability === "unknown" && verdict?.ok && <small className="muted">{es.openParcel.capabilityUnknown}</small>}
                {crop === false && (
                  <p className="coverage-note is-warn" role="alert">
                    {es.openParcel.notCrop}
                  </p>
                )}
                {crop === true && <small className="muted">{es.openParcel.coverageOk}</small>}
                {crop === null && verdict?.ok && <small className="muted">{es.openParcel.coverageUnknown}</small>}
                <button
                  type="button"
                  className="play-button wide-button"
                  disabled={!verdict?.ok || busy}
                  onClick={() => openParcelAt(selected)}
                >
                  {es.openParcel.open} ↗
                </button>
                {note && (
                  <p className="coverage-note is-warn" role="alert" data-testid="open-note">
                    {note}
                  </p>
                )}
                {verdict?.ok && <small className="muted">{es.openParcel.openHint}</small>}
              </>
            )}
            <button type="button" className="ghost-button wide-button" onClick={analyze} disabled={pointLoading}>
              {es.geo.analyze}
            </button>
            <small className="muted">{es.geo.analyzeHint}</small>
          </>
        ) : (
          <p className="muted">{es.geo.choose}</p>
        )}
      </section>
      {phase !== "idle" && phase !== "ready" && !isPilotFarm(farmId) && <LoadProgress />}
      <section className="card">
        <h3>{es.geo.pilotTitle}</h3>
        <p className="muted">{es.geo.pilotHint}</p>
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
        <span className="eyebrow">{es.stages.map.toUpperCase()}</span>
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
