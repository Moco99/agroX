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

// Precomputed degree ticks around the orbital HUD ring
const HUD_TICKS = Array.from({ length: 72 }, (_, i) => {
  const deg = i * 5;
  const rad = (deg * Math.PI) / 180;
  const major = deg % 30 === 0;
  const r1 = 238;
  const r2 = major ? 246 : 242;
  return {
    deg,
    major,
    x1: 300 + r1 * Math.cos(rad),
    y1: 300 + r1 * Math.sin(rad),
    x2: 300 + r2 * Math.cos(rad),
    y2: 300 + r2 * Math.sin(rad),
  };
});

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

        {stage === "globe" && (
          <svg className="globe-hud-rings" viewBox="0 0 600 600" aria-hidden>
            <defs>
              <radialGradient id="globeAtmosGlow" cx="50%" cy="50%" r="50%">
                <stop offset="68%" stopColor="rgba(56, 189, 248, 0)" />
                <stop offset="76%" stopColor="rgba(56, 189, 248, 0.22)" />
                <stop offset="81%" stopColor="rgba(147, 197, 253, 0.35)" />
                <stop offset="85%" stopColor="rgba(59, 130, 246, 0.12)" />
                <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
              </radialGradient>
            </defs>
            <circle cx="300" cy="300" r="285" fill="url(#globeAtmosGlow)" />
            <circle
              cx="300"
              cy="300"
              r="238"
              fill="none"
              stroke="rgba(186, 218, 255, 0.22)"
              strokeWidth="0.9"
            />
            <circle
              cx="300"
              cy="300"
              r="254"
              fill="none"
              stroke="rgba(148, 197, 255, 0.14)"
              strokeWidth="0.8"
              strokeDasharray="3 5"
            />
            {HUD_TICKS.map((t) => (
              <line
                key={t.deg}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={t.major ? "rgba(210, 232, 255, 0.52)" : "rgba(165, 205, 250, 0.24)"}
                strokeWidth={t.major ? "1.1" : "0.7"}
              />
            ))}
            {/* Cardinal crosshairs (+) */}
            <path
              d="M300 28V44M294 36H306M300 556V572M294 564H306M28 300H44M36 294V306M556 300H572M564 294V306"
              stroke="rgba(220, 238, 255, 0.55)"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        )}

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
