import { useMemo, useState } from "react";
import { ErrorBoundary } from "../../components/error-boundary";
import { FarmMap2D } from "../../components/farm-map-2d";
import { LayerLegend } from "../../components/layer-legend";
import { es, fmt } from "../../i18n/es";
import { layerColor, layerLabel, zoneViews } from "../../lib/derive";
import { makeProjector } from "../../lib/geo";
import { hasWebGL } from "../../lib/webgl";
import { FarmDiorama } from "../../scene/farm-diorama";
import { useTwinStore } from "../../store/twin-store";
import { ExplanationBox } from "./explanation-box";
import { KpiTiles } from "./kpi-tiles";
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
  const [webgl] = useState(hasWebGL);

  const projector = useMemo(() => (farm ? makeProjector(farm.farm) : null), [farm]);
  const views = useMemo(
    () => zoneViews(baseline, scenario, dayIndex, [sentinel2, modis]),
    [baseline, scenario, dayIndex, sentinel2, modis],
  );
  if (!farm || !baseline || !projector) return null;

  const selected = views.find((v) => v.zone.zone_id === selectedZoneId) ?? views[0] ?? null;
  const baseZone = baseline.zones.find((z) => z.zone_id === selected?.zone.zone_id) ?? null;
  const scenZone = scenario?.zones.find((z) => z.zone_id === selected?.zone.zone_id) ?? null;
  const date = selected?.state?.date;
  const pFraction = selected?.state && selected.state.taw_mm > 0 ? selected.state.raw_mm / selected.state.taw_mm : null;
  const zoneStyles = Object.fromEntries(
    views.map((v) => [v.zone.zone_id, { fill: layerColor(v, layer), label: layerLabel(v, layer) }]),
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
        <div className="canvas-legend">
          <LayerLegend layer={layer} note={es.app.illustrative} />
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <h2>{es.twin.panelTitle}</h2>
          <small className="muted">
            {farm.farm.name} · {fmt(farm.farm.area_ha, 0)} ha · {farm.farm.zones.length} zonas
          </small>
        </div>
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
            <p className="chart-note">
              Monte Carlo (n={mc.n}): Ks medio p10–p90 {fmt(mc.mean_ks_p10, 2)}–{fmt(mc.mean_ks_p90, 2)}; días con
              estrés p10–p90 {fmt(mc.stress_days_p10, 0)}–{fmt(mc.stress_days_p90, 0)}.
            </p>
          )}
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
