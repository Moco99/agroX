import { useEffect } from "react";
import { DataBanner } from "./app-shell/data-banner";
import { HelpPopover } from "./app-shell/help-popover";
import { IntroControls } from "./app-shell/intro-controls";
import { LayerBar } from "./app-shell/layer-bar";
import { MapLayerBar } from "./app-shell/map-layer-bar";
import { NdviPlayer } from "./app-shell/ndvi-player";
import { Sidebar } from "./app-shell/sidebar";
import { Timeline } from "./app-shell/timeline";
import { TopBar } from "./app-shell/top-bar";
import { TransitionOverlay } from "./app-shell/transition-overlay";
import { es } from "./i18n/es";
import { DigitalTwinScreen } from "./screens/digital-twin/digital-twin-screen";
import { FarmMapScreen } from "./screens/farm-map/farm-map-screen";
import { GlobeScreen } from "./screens/globe/globe-screen";
import { AUTOPILOT_GLOBE_HOLD_MS, AUTOPILOT_MAP_HOLD_MS, useStageStore } from "./store/stage-store";
import { useTwinStore } from "./store/twin-store";

// ─────────────────────────────────────────
// Section: App shell + stage router (globe → map → twin)
// ─────────────────────────────────────────

export function App() {
  const init = useTwinStore((s) => s.init);
  const loading = useTwinStore((s) => s.loading);
  const error = useTwinStore((s) => s.error);
  const baseline = useTwinStore((s) => s.baseline);
  const stage = useStageStore((s) => s.stage);
  const phase = useStageStore((s) => s.phase);
  const autopilot = useStageStore((s) => s.autopilot);
  const goTo = useStageStore((s) => s.goTo);
  const skipIntro = useStageStore((s) => s.skipIntro);

  useEffect(() => {
    void init();
  }, [init]);

  // Cinematic autopilot: hold on the globe, fly to the farm, hold on the map, descend into the twin.
  // It waits for the twin data so the map never appears empty, and any user action cancels it.
  useEffect(() => {
    if (!autopilot || phase !== "idle") return;
    if (stage === "globe" && baseline) {
      const id = setTimeout(() => goTo("map"), AUTOPILOT_GLOBE_HOLD_MS);
      return () => clearTimeout(id);
    }
    if (stage === "map") {
      const id = setTimeout(() => goTo("twin"), AUTOPILOT_MAP_HOLD_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [autopilot, phase, stage, baseline, goTo]);

  // Esc skips straight to the twin from any earlier stage
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useStageStore.getState().stage !== "twin") skipIntro();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skipIntro]);

  const ready = baseline !== null;

  return (
    <div className="app" data-stage={stage}>
      <Sidebar />
      <div className="main">
        <TopBar />
        <DataBanner />
        {error && (
          <div className="error-box" role="alert">
            {baseline ? error : `${es.app.backendDown} (${error})`}{" "}
            <button type="button" className="ghost-button" onClick={() => void init()}>
              {es.app.retry}
            </button>
          </div>
        )}
        <div className="stage-host">
          {stage === "globe" && <GlobeScreen />}
          {stage === "map" && (ready ? <FarmMapScreen /> : <div className="loading">{es.app.loading}</div>)}
          {stage === "twin" && (ready ? <DigitalTwinScreen /> : loading ? <div className="loading">{es.app.loading}</div> : null)}
          <TransitionOverlay />
          <IntroControls />
        </div>
        <footer className="bottom-bar">
          {stage === "globe" && (
            <>
              <MapLayerBar />
              <NdviPlayer />
            </>
          )}
          {stage === "map" && <><MapLayerBar /><NdviPlayer withLabel /></>}
          {stage === "twin" && ready && (
            <>
              <LayerBar />
              <Timeline />
            </>
          )}
        </footer>
      </div>
      <HelpPopover />
    </div>
  );
}
