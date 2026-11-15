import { es } from "../i18n/es";
import { layerRamp } from "../lib/derive";
import type { Layer } from "../store/twin-store";

const UNITS: Record<Layer, string> = {
  ndvi: "NDVI",
  stress: "Ks",
  moisture: "% TAW",
  temperature: "°C",
  irrigation: "mm",
};

function label(layer: Layer, v: number): string {
  if (layer === "moisture") return `${Math.round(v * 100)}`;
  if (layer === "ndvi" || layer === "stress") return v.toFixed(2);
  return `${v}`;
}

export function LayerLegend({ layer, note, ndviStatus }: { layer: Layer; note?: string; ndviStatus?: string }) {
  const ramp = layerRamp(layer);
  const first = ramp[0]?.value ?? 0;
  const last = ramp[ramp.length - 1]?.value ?? 1;
  const gradient = ramp.map((s) => `${s.hex} ${((s.value - first) / (last - first || 1)) * 100}%`).join(", ");
  return (
    <div className="legend">
      <div className="legend-title">
        {es.layers[layer]} ({UNITS[layer]})
        {layer === "ndvi" && ndviStatus && <small className="muted"> · {ndviStatus}</small>}
      </div>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      <div className="legend-ticks">
        {ramp.map((s) => (
          <span key={s.value}>{label(layer, s.value)}</span>
        ))}
      </div>
      {note && <div className="legend-note">{note}</div>}
    </div>
  );
}
