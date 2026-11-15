import { useRotationView } from "./store/rotation-store";
import { lazy, Suspense, useEffect } from "react";
import { DataBanner } from "./app-shell/data-banner";
import { GuidePanel } from "./app-shell/guide-panel";
import { HelpPopover } from "./app-shell/help-popover";
import { LayerBar } from "./app-shell/layer-bar";
import { MapLayerBar } from "./app-shell/map-layer-bar";
import { NdviPlayer } from "./app-shell/ndvi-player";
import { navigateTo, Sidebar } from "./app-shell/sidebar";
import { Timeline } from "./app-shell/timeline";
import { TopBar } from "./app-shell/top-bar";
import { TransitionOverlay } from "./app-shell/transition-overlay";
import { ErrorBoundary } from "./components/error-boundary";
import { es } from "./i18n/es";
import { LoadProgress } from "./screens/geographic/parcel-panels";
import { useParcelStore } from "./store/parcel-store";
import { usePointStore } from "./store/point-store";
import { useModuleView } from "./store/module-store";
import { useStageStore } from "./store/stage-store";
import { useTwinStore } from "./store/twin-store";

// ─────────────────────────────────────────
// Section: Code-split stages (MapLibre and three.js/R3F load only when their stage is shown)
// ─────────────────────────────────────────

const RotationScreen = lazy(() => import("./screens/rotation/rotation-screen"));
const ClimateScreen = lazy(() => import("./screens/climate/climate-screen"));
const VegetationScreen = lazy(() => import("./screens/vegetation/vegetation-screen"));
const ReportScreen = lazy(() => import("./screens/reports/report-screen"));
const GeographicScreen = lazy(() => import("./screens/geographic/geographic-screen"));
const DigitalTwinScreen = lazy(() =>
  import("./screens/digital-twin/digital-twin-screen").then((m) => ({ default: m.DigitalTwinScreen })),
);

// ─────────────────────────────────────────
// Section: App shell + stage router (globe → map → twin)
// ─────────────────────────────────────────

export function App() {
  const rotationActive = useRotationView((s) => s.active);
  const moduleActive = useModuleView((s) => s.active);
  const fullPage = rotationActive || moduleActive !== null;
  const init = useTwinStore((s) => s.init);
  const loading = useTwinStore((s) => s.loading);
  const error = useTwinStore((s) => s.error);
  const baseline = useTwinStore((s) => s.baseline);
  const stage = useStageStore((s) => s.stage);
  const phase = useParcelStore((s) => s.phase);
  const geo = stage !== "twin";

  useEffect(() => {
    void init();
  }, [init]);

  // Esc closes the point overlay first (and aborts its request); the stages themselves never trap the key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && usePointStore.getState().active) usePointStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadingBox = <div className="loading">{es.app.loading}</div>;

  return (
    <div className="app" data-stage={stage}>
      <Sidebar />
      <div className="main">
        <TopBar />
        {stage === "twin" && !fullPage && <DataBanner />}
        {stage === "twin" && !fullPage && error && (
          <div className="error-box" role="alert">
            {baseline ? error : `${es.app.backendDown} (${error})`}{" "}
            <button type="button" className="ghost-button" onClick={() => void init()}>
              {es.app.retry}
            </button>
          </div>
        )}
        <div className="stage-host">
          <ErrorBoundary fallback={<div className="error-box" role="alert">{es.app.stageFailed}</div>}>
            <Suspense fallback={loadingBox}>
              {moduleActive === "climate" ? (
                <ClimateScreen />
              ) : moduleActive === "vegetation" ? (
                <VegetationScreen />
              ) : moduleActive === "reports" ? (
                <ReportScreen />
              ) : rotationActive ? (
                <RotationScreen />
              ) : geo ? (
                <GeographicScreen />
              ) : baseline ? (
                <>
                  <DigitalTwinScreen />
                  <button type="button" className="ghost-button back-to-map" onClick={() => navigateTo("map")}>
                    ← {es.stages.backToMap}
                  </button>
                </>
              ) : phase === "idle" || phase === "ready" ? (
                loading ? loadingBox : null
              ) : (
                <div className="twin-pending">
                  <LoadProgress />
                </div>
              )}
            </Suspense>
          </ErrorBoundary>
          <TransitionOverlay />
        </div>
        {!fullPage && <footer className="bottom-bar">
          {geo ? (
            <>
              <MapLayerBar />
              <NdviPlayer withLabel={stage === "map"} />
            </>
          ) : (
            baseline && (
              <>
                <LayerBar />
                <Timeline />
              </>
            )
          )}
        </footer>}
      </div>
      <HelpPopover />
      <GuidePanel />
    </div>
  );
}
