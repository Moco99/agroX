import { useState } from "react";
import { es, fmtDate } from "../i18n/es";
import { useStageStore } from "../store/stage-store";
import { SEASONS, seasonRange, useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Top bar (search ⌘K, season range, layer count, notifications, help, avatar)
// ─────────────────────────────────────────

export function TopBar() {
  const year = useTwinStore((s) => s.year);
  const loadSeason = useTwinStore((s) => s.loadSeason);
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const stage = useStageStore((s) => s.stage);
  const setShowCredits = useStageStore((s) => s.setShowCredits);
  const showCredits = useStageStore((s) => s.showCredits);
  const [searchOpen, setSearchOpen] = useState(false);
  const { start, end } = seasonRange(year);
  // The twin stage always has exactly one active layer (radio); globe/map count their toggles
  const layerCount = stage === "twin" ? 1 : Object.values(mapLayers).filter(Boolean).length;

  return (
    <header className="top-bar">
      <div className="search-wrap">
        <button type="button" className="search" onClick={() => setSearchOpen(!searchOpen)} aria-expanded={searchOpen}>
          <span aria-hidden>⌕</span>
          <span className="search-placeholder">{es.topbar.search}</span>
          <kbd>{es.topbar.shortcut}</kbd>
        </button>
        {searchOpen && (
          <div className="search-pop" role="dialog">
            <strong>{es.topbar.searchResult}</strong>
            <small>{es.topbar.searchHint}</small>
          </div>
        )}
      </div>
      <div className="top-bar-right">
        <label className="date-range" title={es.topbar.season}>
          <span aria-hidden>▦</span>
          <span>
            {fmtDate(start)} – {fmtDate(end)}
          </span>
          <select value={year} onChange={(e) => void loadSeason(Number(e.target.value))} aria-label={es.topbar.season}>
            {SEASONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="chip-button" title={es.layers.title}>
          <span aria-hidden>▤</span> {es.topbar.layers(layerCount)}
        </span>
        <button type="button" className="icon-round" title={es.topbar.notifications} aria-label={es.topbar.notifications}>
          <span aria-hidden>🔔</span>
          <i className="dot" aria-hidden />
        </button>
        <button
          type="button"
          className={`icon-round${showCredits ? " is-active" : ""}`}
          title={es.topbar.help}
          aria-label={es.topbar.help}
          onClick={() => setShowCredits(!showCredits)}
        >
          ?
        </button>
        <span className="avatar" title={es.topbar.account}>
          A
        </span>
      </div>
    </header>
  );
}
