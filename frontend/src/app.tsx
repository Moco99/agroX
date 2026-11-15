import { useEffect } from "react";
import { DataBanner } from "./app-shell/data-banner";
import { LayerBar } from "./app-shell/layer-bar";
import { Sidebar } from "./app-shell/sidebar";
import { Timeline } from "./app-shell/timeline";
import { TopBar } from "./app-shell/top-bar";
import { es } from "./i18n/es";
import { DigitalTwinScreen } from "./screens/digital-twin/digital-twin-screen";
import { ParcelNdviScreen } from "./screens/parcel-ndvi/parcel-ndvi-screen";
import { useTwinStore } from "./store/twin-store";

export function App() {
  const init = useTwinStore((s) => s.init);
  const loading = useTwinStore((s) => s.loading);
  const error = useTwinStore((s) => s.error);
  const screen = useTwinStore((s) => s.screen);
  const baseline = useTwinStore((s) => s.baseline);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
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
        {loading && !baseline && <div className="loading">{es.app.loading}</div>}
        {baseline && (screen === "twin" ? <DigitalTwinScreen /> : <ParcelNdviScreen />)}
        {baseline && (
          <footer className="bottom-bar">
            {screen === "twin" && <LayerBar />}
            <Timeline />
          </footer>
        )}
      </div>
    </div>
  );
}
