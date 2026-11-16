import { useMemo, useState } from "react";
import { ErrorBoundary } from "../../components/error-boundary";
import { FarmMap2D } from "../../components/farm-map-2d";
import { LayerLegend } from "../../components/layer-legend";
import { es, fmt, fmtDate } from "../../i18n/es";
import { layerColor, layerLabel, zoneViews } from "../../lib/derive";
import { makeProjector } from "../../lib/geo";
import { isPilotFarm } from "../../lib/parcel";
import { scenarioLabel } from "../../lib/climate-projection";
import { navigateTo } from "../../app-shell/sidebar";
import { DataStateBadge } from "../../components/data-state-badge";
import { DataStateLegend } from "../../components/explain/data-state-legend";
import { ModelNote } from "../../components/explain/model-note";
import { Term } from "../../components/explain/term";
import { useParcelStore } from "../../store/parcel-store";
import { hasWebGL } from "../../lib/webgl";
import { SimulationPeriod } from "./simulation-period";
import { FarmDiorama } from "../../scene/farm-diorama";
import { useTwinStore } from "../../store/twin-store";
import { cropLabel, fallbackNote, ndviMissingText, stageStatusOf } from "../../lib/farm-labels";
import { ExplanationBox } from "./explanation-box";
import { KpiTiles } from "./kpi-tiles";
import { SeasonOutcomeCard } from "./season-outcome";
import { SimulationPanel } from "./simulation-panel";
import { TwinCharts } from "./twin-charts";

// ─────────────────────────────────────────
// Section: S3 · Digital twin screen (canvas + right panel)
// ─────────────────────────────────────────

export function DigitalTwinScreen() {
  const farm = useTwinStore((s) => s.farm);
  const baseline = useTwinStore((s) => s.baseline);
  const scenario = useTwinStore((s) => s.scenario);
  const config = useTwinStore((s) => s.config);
  const dayIndex = useTwinStore((s) => s.dayIndex);
  const layer = useTwinStore((s) => s.layer);
  const selectedZoneId = useTwinStore((s) => s.selectedZoneId);
  const selectZone = useTwinStore((s) => s.selectZone);
  const canvasTab = useTwinStore((s) => s.canvasTab);
  const setCanvasTab = useTwinStore((s) => s.setCanvasTab);
  const modis = useTwinStore((s) => s.modis);
  const sentinel2 = useTwinStore((s) => s.sentinel2);
  const smap = useTwinStore((s) => s.smap);
  const terrainImagery = useTwinStore((s) => s.terrainImagery);
  const contextLoaded = useTwinStore((s) => s.contextLoaded);
  const heightmap = useTwinStore((s) => s.heightmap);
  const plan = useTwinStore((s) => s.plan);
  const declaration = useParcelStore((s) => s.declaration);
  const catalog = useParcelStore((s) => s.catalog);
  const setDeclaration = useParcelStore((s) => s.setDeclaration);
  const applyDeclaration = useTwinStore((s) => s.applyDeclaration);
  const rotation = useTwinStore((s) => s.rotationPreview);
  const simulating = useTwinStore((s) => s.simulating);
  const previewRotation = useTwinStore((s) => s.previewRotation);
  const clearRotationPreview = useTwinStore((s) => s.clearRotationPreview);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [webgl] = useState(hasWebGL);

  async function changeCycle(index: number) {
    if (!rotation) return;
    const controls = useTwinStore.getState().controls;
    setPreviewError(null);
    try {
      await previewRotation({ ...rotation, index, precipPct: controls.precipPct, tempDelta: controls.tempDelta });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPreviewError(error instanceof Error ? error.message : es.twinCopy.cycleFailed);
    }
  }

  const projector = useMemo(() => (farm ? makeProjector(farm.farm) : null), [farm]);
  const referenceYear = useTwinStore((s) => s.referenceYear);
  const projection = useTwinStore((s) => s.projection);
  // Observations belong to the real parcel and dates: never pair them with a simulated-climate or hypothetical-crop run
  const hideObserved = referenceYear !== null || projection !== null || rotation !== null;
  const views = useMemo(
    () => zoneViews(baseline, scenario, dayIndex, hideObserved ? [] : [sentinel2, modis]),
    [baseline, scenario, dayIndex, sentinel2, modis, hideObserved],
  );
  if (!farm || !baseline || !projector) return null;

  const selected = views.find((v) => v.zone.zone_id === selectedZoneId) ?? views[0] ?? null;
  const baseZone = baseline.zones.find((z) => z.zone_id === selected?.zone.zone_id) ?? null;
  const scenZone = scenario?.zones.find((z) => z.zone_id === selected?.zone.zone_id) ?? null;
  const date = selected?.state?.date;
  const pFraction = selected?.state && selected.state.taw_mm > 0 ? selected.state.raw_mm / selected.state.taw_mm : null;
  // Declared before zoneStyles: Object.fromEntries runs its callback eagerly (TDZ otherwise crashes the screen)
  const pilotFarm = isPilotFarm(farm.farm.farm_id);
  const ndviMissing = hideObserved ? es.ndviNotObserved : pilotFarm ? undefined : ndviMissingText(stageStatusOf(farm, "ndvi"));
  const zoneStyles = Object.fromEntries(
    views.map((v) => [v.zone.zone_id, { fill: layerColor(v, layer), label: layerLabel(v, layer, ndviMissing) }]),
  );
  const map2d = (
    <FarmMap2D
      farm={farm.farm}
      projector={projector}
      zoneStyles={zoneStyles}
      selectedZoneId={selected?.zone.zone_id ?? null}
      onSelect={selectZone}
    />
  );
  const show3d = canvasTab === "twin" && webgl;
  const fallbackMsg = fallbackNote(terrainImagery, Boolean(heightmap), contextLoaded);
  const mc = scenZone?.monte_carlo ?? baseZone?.monte_carlo ?? null;

  return (
    <div className="screen">
      <div className="canvas-area">
        <div className="canvas-tabs">
          <button type="button" className={canvasTab === "twin" ? "is-active" : ""} onClick={() => setCanvasTab("twin")}>
            {es.twin.tabs.twin}
          </button>
          <button type="button" className={canvasTab === "map2d" ? "is-active" : ""} onClick={() => setCanvasTab("map2d")}>
            {es.twin.tabs.map2d}
          </button>
        </div>
        <div className="canvas-stage" data-testid={show3d ? "canvas-3d" : "canvas-2d"}>
          {show3d ? (
            <ErrorBoundary fallback={map2d}>
              <FarmDiorama
                farm={farm.farm}
                projector={projector}
                views={views}
                layer={layer}
                date={date}
                selectedZoneId={selected?.zone.zone_id ?? null}
                onSelect={selectZone}
              />
            </ErrorBoundary>
          ) : (
            map2d
          )}
        </div>
        {!webgl && canvasTab === "twin" && <div className="canvas-notice">{es.twin.noWebgl}</div>}
        {show3d && !isPilotFarm(farm.farm.farm_id) && fallbackMsg && (
          <div className="canvas-notice is-info" role="status" data-testid="twin-fallback-note">
            {fallbackMsg}
          </div>
        )}
        <div className="canvas-legend">
          <LayerLegend layer={layer} note={es.app.illustrative} ndviStatus={views.some((v) => v.ndvi) ? undefined : ndviMissing} />
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <h2>{es.twin.panelTitle}</h2>
          <small className="muted">
            {farm.farm.name} · {fmt(farm.farm.area_ha, 0)} ha · {es.twinCopy.zonesCount(farm.farm.zones.length)}
          </small>
        </div>
        <ModelNote withScore={false} />
        {rotation && (
          <section className="card declared-summary">
            <div className="card-head">
              <h3>{es.twinCopy.rotationTrial}</h3>
              <DataStateBadge state={baseline.data_mode === "synthetic" ? "SYNTHETIC" : "SIMULATED"} compact />
            </div>
            <p className="muted">{rotation.cycles.map((cycle) => cycle.name).join(" → ")}</p>
            <p className="muted">{es.twinCopy.rotationTrialHint}</p>
            <label className="field">
              <span>{es.twinCopy.cycleInTwin}</span>
              <select disabled={simulating} value={rotation.index} onChange={(e) => void changeCycle(Number(e.target.value))}>
                {rotation.cycles.map((cycle, index) => (
                  <option key={index} value={index} disabled={!cycle.supported}>
                    {index + 1} · {cycle.name}{cycle.supported ? "" : ` · ${es.twinCopy.noParams}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{fmtDate(baseline.start)} a {fmtDate(baseline.end)}</p>
            {previewError && <p className="error-box" role="alert">{previewError}</p>}
            <button type="button" className="ghost-button" disabled={simulating} onClick={() => void clearRotationPreview()}>
              {es.twinCopy.backToCrops}
            </button>
          </section>
        )}
        {!rotation && (
          <section className="card declared-summary" data-testid="declared-summary">
            <div className="card-head">
              <h3>{es.openParcel.declTitle}</h3>
              <DataStateBadge state="DECLARED" compact />
            </div>
            <p className="muted">{es.weatherReference.cropHint}</p>
            {!pilotFarm && farm.farm.zones.some((z) => !declaration.crops[z.zone_id]) && <p className="muted">{es.assumedCropNote}</p>}
            <ul className="crop-plan-list">
              {farm.farm.zones.map((z) => {
                // What the last run actually used for this zone (crop, planting and their data states)
                const used = baseline.zones.find((r) => r.zone_id === z.zone_id);
                const crop = used?.crop_id ?? plan?.zoneCrops[z.zone_id] ?? z.crop_id;
                const declaredCrop = pilotFarm || Boolean(declaration.crops[z.zone_id]);
                return (
                  <li key={z.zone_id}>
                    <div className="crop-plan-head">
                      <strong>{z.name}</strong>
                      <DataStateBadge state={declaredCrop ? (used?.crop_state ?? "DECLARED") : cropLabel(crop, false).state} compact />
                    </div>
                    <select
                      aria-label={`${es.openParcel.declZone}: ${z.name}`}
                      disabled={simulating}
                      value={declaration.crops[z.zone_id] ?? (pilotFarm ? crop : "")}
                      onChange={(e) => {
                        // Same contract as the farm map: the declaration feeds crop_overrides on the next run
                        setDeclaration({ ...declaration, crops: { ...declaration.crops, [z.zone_id]: e.target.value } });
                        void applyDeclaration();
                      }}
                    >
                      <option value="" disabled>{cropLabel(crop, false).text}</option>
                      {(catalog?.crops ?? []).map((c) => (
                        <option key={c.crop_id} value={c.crop_id}>{c.name_es}</option>
                      ))}
                    </select>
                    <div className="crop-plan-date">
                      <span>
                        {es.weatherReference.plantingUsed}: {used ? fmtDate(used.planting_date) : "—"}{" "}
                        <DataStateBadge state={used?.planting_state ?? "ESTIMATED"} compact />
                      </span>
                      <label className="field">
                        <span>{es.weatherReference.plantingDate}</span>
                        <input
                          type="date"
                          aria-label={`${es.weatherReference.plantingDate}: ${z.name}`}
                          disabled={simulating || !declaredCrop}
                          value={declaration.planting[crop] ?? ""}
                          onChange={(e) => {
                            const plantingDates = { ...declaration.planting };
                            if (e.target.value) plantingDates[crop] = e.target.value;
                            else delete plantingDates[crop];
                            setDeclaration({ ...declaration, planting: plantingDates });
                            void applyDeclaration();
                          }}
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="ghost-button" onClick={() => navigateTo("map")}>
              {es.openParcel.declEdit}
            </button>
          </section>
        )}
        <SimulationPeriod />
        <SeasonOutcomeCard run={scenario ?? baseline} />
        <SimulationPanel />
        <section className="card">
          <div className="card-head">
            <h3>
              {es.twin.selectedZone}: {selected?.zone.name}
            </h3>
          </div>
          <small className="muted">{es.twin.zoneHint}</small>
          <KpiTiles view={selected} hasScenario={scenario !== null} config={config} />
          {mc && (
            <p className="chart-note" data-testid="monte-carlo">
              <Term id="monteCarlo" />:{" "}
              {es.twinCopy.monteCarlo(mc.n, fmt(mc.mean_ks_p10, 2), fmt(mc.mean_ks_p90, 2), fmt(mc.stress_days_p10, 0), fmt(mc.stress_days_p90, 0))}
            </p>
          )}
          <DataStateLegend
            sources={baseline.climate_projection
              ? [es.banner.projection(scenarioLabel(baseline.climate_projection.scenario)) + ` (${baseline.climate_projection.models_used.join(", ")})`]
              : []}
          />
        </section>
        <ExplanationBox baseline={baseline} scenario={scenario} selectedZoneId={selected?.zone.zone_id ?? null} />
        {baseZone && (
          <TwinCharts
            baseZone={baseZone}
            scenZone={scenZone}
            modis={modis}
            sentinel2={sentinel2}
            smap={smap}
            currentDate={date}
            depletionFraction={pFraction}
          />
        )}
      </aside>
    </div>
  );
}
