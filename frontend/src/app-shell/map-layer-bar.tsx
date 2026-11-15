import { es } from "../i18n/es";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Globe/map layer toggles (only layers with real data behind them: the pilot NDVI and boundaries)
// ─────────────────────────────────────────

// Precipitation/temperature map layers were dropped with the three.js globe: there is no global raster for them yet
const LAYERS = [
  { id: "ndvi", label: es.geo.ndvi },
  { id: "boundaries", label: es.geo.boundaries },
] as const;

export function MapLayerBar() {
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const toggle = useTwinStore((s) => s.toggleMapLayer);
  const active = LAYERS.filter((l) => mapLayers[l.id]).length;
  return (
    <div className="layer-bar" role="group" aria-label={es.layers.title}>
      <span className="layer-bar-title">
        <span aria-hidden>▤</span> {es.layers.title} ({active})
      </span>
      {LAYERS.map((l) => (
        <label key={l.id} className={`layer-chip is-check${mapLayers[l.id] ? " is-active" : ""}`}>
          <input type="checkbox" checked={mapLayers[l.id]} onChange={() => toggle(l.id)} />
          {l.label}
        </label>
      ))}
    </div>
  );
}
