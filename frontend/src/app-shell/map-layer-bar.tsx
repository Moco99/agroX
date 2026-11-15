import { es } from "../i18n/es";
import { useStageStore } from "../store/stage-store";
import { useTwinStore, type MapLayer } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Globe/map layer toggles (every toggle drives a visible change, see globe-scene / farm-map)
// ─────────────────────────────────────────

const LAYERS: MapLayer[] = ["ndvi", "precipitation", "temperature", "boundaries"];

export function MapLayerBar() {
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const toggle = useTwinStore((s) => s.toggleMapLayer);
  const region = useTwinStore((s) => s.region);
  const stage = useStageStore((s) => s.stage);
  const active = Object.values(mapLayers).filter(Boolean).length;
  const hint: Partial<Record<MapLayer, string>> = {
    precipitation: es.mapLayers.precipitationHint,
    temperature: es.mapLayers.temperatureHint,
  };
  return (
    <div className="layer-bar" role="group" aria-label={es.layers.title}>
      <span className="layer-bar-title">
        <span aria-hidden>▤</span> {es.layers.title} ({active})
      </span>
      {LAYERS.map((l) => {
        // Precipitation/temperature colour the region marker and need the regional summary
        const needsRegion = l === "precipitation" || l === "temperature";
        const disabled = needsRegion && (!region || stage !== "globe");
        return (
          <label key={l} className={`layer-chip is-check${mapLayers[l] ? " is-active" : ""}${disabled ? " is-disabled" : ""}`} title={disabled ? es.mapLayers.disabled : hint[l]}>
            <input type="checkbox" checked={mapLayers[l]} disabled={disabled} onChange={() => toggle(l)} />
            <span className="check-box" aria-hidden>
              {mapLayers[l] ? "✓" : ""}
            </span>
            {es.mapLayers[l]}
          </label>
        );
      })}
    </div>
  );
}
