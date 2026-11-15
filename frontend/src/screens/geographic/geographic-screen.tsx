import { useCallback, useState } from "react";
import { es } from "../../i18n/es";
import { metresPerPixel } from "../../lib/globe-view";
import { useMapStore } from "../../store/map-store";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import { NDVI_RAMP } from "../../styles/tokens";
import { FarmPanel, GlobePanel } from "./geo-panels";
import { GlobeMap, type MapStatus } from "./globe-map";

// ─────────────────────────────────────────
// Section: Journey stepper (1. Ubicación → 2. Granja → 3. Análisis), shown once the camera reaches the farm
// ─────────────────────────────────────────

function Stepper() {
  const farm = useTwinStore((s) => s.farm)?.farm;
  const farmSub = farm ? `${farm.area_ha.toFixed(0)} ha · ${farm.zones.length} zonas` : es.stages.stepper.farm.sub;
  const steps = [
    { ...es.stages.stepper.location, state: "done", onClick: () => useMapStore.getState().flyTo("globe") },
    { ...es.stages.stepper.farm, sub: farmSub, state: "active", onClick: undefined },
    { ...es.stages.stepper.analysis, state: "todo", onClick: () => useStageStore.getState().goTo("twin") },
  ] as const;
  return (
    <ol className="journey-stepper" aria-label={es.stages.map}>
      {steps.map((s) => (
        <li key={s.title} className={`is-${s.state}`}>
          <button type="button" onClick={s.onClick} disabled={!s.onClick} aria-current={s.state === "active" ? "step" : undefined}>
            <span className="step-dot" aria-hidden>
              {s.state === "done" || s.state === "active" ? "✓" : ""}
            </span>
            <span>
              <strong>{s.title}</strong>
              <small>{s.sub}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// NDVI colour ramp legend matching the raster served by /api/imagery/ndvi (same tokens)
function NdviLegend() {
  const first = NDVI_RAMP[0];
  const last = NDVI_RAMP[NDVI_RAMP.length - 1];
  const gradient = `linear-gradient(90deg, ${NDVI_RAMP.map((s) => s.hex).join(", ")})`;
  return (
    <div className="ndvi-legend" role="img" aria-label={es.map.legend}>
      <strong>{es.map.legend}</strong>
      <i style={{ background: gradient }} />
      <span>
        <small>≤ {first?.value.toFixed(1)}</small>
        <small>≥ {last?.value.toFixed(1)}</small>
      </span>
    </div>
  );
}

function fmtCoord(val: number, posHem: string, negHem: string): string {
  const hem = val >= 0 ? posHem : negHem;
  return `${Math.abs(val).toFixed(4)}° ${hem}`;
}

// ─────────────────────────────────────────
// Section: Geographic screen (globe + farm stages over one MapLibre view)
// ─────────────────────────────────────────

export default function GeographicScreen() {
  const stage = useStageStore((s) => s.stage);
  const phase = useStageStore((s) => s.phase);
  const pending = useStageStore((s) => s.pending);
  const interacted = useMapStore((s) => s.interacted);
  const layers = useTwinStore((s) => s.mapLayers);
  const hasBaseline = useTwinStore((s) => s.baseline !== null);
  const [status, setStatus] = useState<MapStatus | null>(null);
  const onStatus = useCallback((s: MapStatus) => setStatus(s), []);
  const atFarm = stage === "map";
  const flying = phase === "flying";
  const latVal = status ? status.lat : 41.878;
  const lonVal = status ? status.lon : -93.0977;

  return (
    <div className="screen geographic-screen" data-geo-stage={stage}>
      <div className="canvas-area geographic-area">
        <GlobeMap onStatus={onStatus} />

        <div className="hud-coords" aria-hidden>
          <span className="hud-coords-label">COORDENADAS</span>
          <strong>{fmtCoord(latVal, "N", "S")}</strong>
          <strong>{fmtCoord(lonVal, "E", "W")}</strong>
        </div>

        {status?.ready && (
          <div className="geographic-status" role="status">
            <div className="hud-source-row">
              <span className="hud-slashes" aria-hidden>
                ///
              </span>{" "}
              <em>{status.offline ? es.geo.offlineTitle : es.geo.source(status.zoom)}</em>
            </div>
            <div className="hud-res-row">
              Resolución: {es.geo.scale(metresPerPixel(status.zoom, status.lat))} · {es.geo.zoom(status.zoom)}
            </div>
          </div>
        )}

        {stage === "globe" && (
          <div className="hud-imagery-credit" aria-hidden>
            <strong>IMAGERY: NASA</strong>
            <span>Earth Observatory (Blue Marble)</span>
          </div>
        )}

        {atFarm && !flying && <Stepper />}
        {flying && (
          <p className="flight-hint" role="status">
            {pending === "map" ? es.geo.flyingPilot : es.geo.flying}
          </p>
        )}
        {stage === "globe" && !interacted && !flying && <p className="gesture-hint">{es.geo.gesture}</p>}
        {atFarm && (
          <div className="imagery-switch" role="group" aria-label={es.layers.title}>
            <button
              type="button"
              className={layers.ndvi ? "" : "is-active"}
              aria-pressed={!layers.ndvi}
              onClick={() => layers.ndvi && useTwinStore.getState().toggleMapLayer("ndvi")}
            >
              {es.geo.imagery}
            </button>
            <button
              type="button"
              className={layers.ndvi ? "is-active" : ""}
              aria-pressed={layers.ndvi}
              onClick={() => !layers.ndvi && useTwinStore.getState().toggleMapLayer("ndvi")}
            >
              {es.map.ndvi}
            </button>
          </div>
        )}
        {atFarm && layers.ndvi && <NdviLegend />}
        {atFarm && (
          <div className="farm-actions">
            <button type="button" className="ghost-button" onClick={() => useMapStore.getState().flyTo("globe")}>
              ← {es.geo.backToGlobe}
            </button>
            <button
              type="button"
              className="explore-cta is-inline"
              disabled={!hasBaseline}
              onClick={() => useStageStore.getState().goTo("twin")}
            >
              {es.geo.cta} ↗
            </button>
          </div>
        )}
      </div>
      {atFarm ? <FarmPanel /> : <GlobePanel />}
    </div>
  );
}
