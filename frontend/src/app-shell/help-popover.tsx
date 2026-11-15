import { es } from "../i18n/es";
import { useStageStore } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Help / credits popover (keyboard shortcuts + texture attribution, required by CC BY)
// ─────────────────────────────────────────

export function HelpPopover() {
  const open = useStageStore((s) => s.showCredits);
  const setOpen = useStageStore((s) => s.setShowCredits);
  const fps = useStageStore((s) => s.fps);
  const quality = useStageStore((s) => s.quality);
  if (!open) return null;
  return (
    <div className="help-pop" role="dialog" aria-label={es.topbar.help}>
      <div className="card-head">
        <h3>{es.topbar.help}</h3>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Cerrar">
          ✕
        </button>
      </div>
      <ul>
        <li>
          <kbd>Esc</kbd> {es.stages.skip}
        </li>
        <li>
          <kbd>?stage=globe|map|twin</kbd> enlace directo a una etapa
        </li>
        <li>{es.stages.autoplay}</li>
      </ul>
      <h4>{es.globe.credits}</h4>
      <p>{es.globe.creditsBody}</p>
      <p className="muted">
        {es.scene3d.quality[quality]}
        {fps > 0 ? ` · ${es.scene3d.fps(fps)}` : ""}
      </p>
    </div>
  );
}
