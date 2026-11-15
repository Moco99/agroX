import { es } from "../i18n/es";
import { useStageStore } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Help / credits popover (shortcuts + imagery attribution)
// ─────────────────────────────────────────

export function HelpPopover() {
  const open = useStageStore((s) => s.showCredits);
  const setOpen = useStageStore((s) => s.setShowCredits);
  if (!open) return null;
  return (
    <div className="help-pop" role="dialog" aria-label={es.topbar.help}>
      <div className="card-head">
        <h3>{es.topbar.help}</h3>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label={es.help.close}>
          ✕
        </button>
      </div>
      <ul>
        <li>
          <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> {es.help.search}
        </li>
        <li>
          <kbd>Esc</kbd> {es.help.escape}
        </li>
        <li>
          <kbd>?stage=globe|map|twin</kbd> {es.help.deepLink}
        </li>
      </ul>
      <h4>{es.globe.credits}</h4>
      <p>{es.globe.creditsBody}</p>
    </div>
  );
}
