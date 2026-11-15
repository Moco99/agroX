import type { ReactNode } from "react";
import { es } from "../i18n/es";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Globe/map layer toggles (only layers with real data behind them: the pilot NDVI and boundaries)
// ─────────────────────────────────────────

const LAYERS: ReadonlyArray<{
  id: "ndvi" | "boundaries";
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "ndvi",
    label: es.geo.ndvi,
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
        <path
          d="M3.5 12.5C3.5 7.5 6.8 3.8 12.5 3.5C12.2 9.2 8.5 12.5 3.5 12.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M3.5 12.5L9 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "boundaries",
    label: es.geo.boundaries,
    icon: (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
        <path d="M8 2.5L13.8 5.6L8 8.7L2.2 5.6L8 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M2.2 8.4L8 11.5L13.8 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.2 11.2L8 14.3L13.8 11.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function MapLayerBar() {
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const toggle = useTwinStore((s) => s.toggleMapLayer);
  const active = LAYERS.filter((l) => mapLayers[l.id]).length;
  return (
    <div className="layer-bar" role="group" aria-label={es.layers.title}>
      <span className="layer-bar-title">
        {es.layers.title} ({active}):
      </span>
      {LAYERS.map((l) => (
        <label key={l.id} className={`layer-chip is-check${mapLayers[l.id] ? " is-active" : ""}`}>
          <input type="checkbox" checked={mapLayers[l.id]} onChange={() => toggle(l.id)} />
          <span className="layer-chip-icon" aria-hidden>
            {l.icon}
          </span>
          <span>{l.label}</span>
          <span className="layer-chip-close" aria-hidden>
            {mapLayers[l.id] ? "×" : "+"}
          </span>
        </label>
      ))}
    </div>
  );
}
