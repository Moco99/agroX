import { es } from "../i18n/es";
import { useTwinStore, type Layer } from "../store/twin-store";

const LAYERS: Layer[] = ["ndvi", "moisture", "temperature", "irrigation", "stress"];

export function LayerBar() {
  const layer = useTwinStore((s) => s.layer);
  const setLayer = useTwinStore((s) => s.setLayer);
  return (
    <div className="layer-bar" role="radiogroup" aria-label={es.layers.title}>
      <span className="layer-bar-title">{es.layers.title}</span>
      {LAYERS.map((l) => (
        <label key={l} className={`layer-chip${layer === l ? " is-active" : ""}`}>
          <input type="radio" name="layer" checked={layer === l} onChange={() => setLayer(l)} />
          {es.layers[l]}
        </label>
      ))}
    </div>
  );
}
