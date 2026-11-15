import { useModuleView } from "../store/module-store";
import { useRotationView } from "../store/rotation-store";
import { PointSearch } from "../screens/point/point-search";
import { useEffect, useState } from "react";
import { es, fmtDate } from "../i18n/es";
import { useStageStore } from "../store/stage-store";
import { isPilotFarm } from "../lib/parcel";
import { useParcelStore } from "../store/parcel-store";
import { SEASONS, useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Top bar (brand + NASA Space Apps collaboration, search ⌘K, season range, layer count, notifications, help, avatar)
// ─────────────────────────────────────────

export function TopBar() {
  const year = useTwinStore((s) => s.year);
  const loadSeason = useTwinStore((s) => s.loadSeason);
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const stage = useStageStore((s) => s.stage);
  const setShowCredits = useStageStore((s) => s.setShowCredits);
  const showCredits = useStageStore((s) => s.showCredits);
  const [searchOpen, setSearchOpen] = useState(false);
  const span = useTwinStore((s) => s.span);
  const farmId = useParcelStore((s) => s.farmId);
  const pilot = isPilotFarm(farmId);
  const { start, end } = span;
  // The twin stage always has exactly one active layer (radio); globe/map count their two pilot toggles
  const layerCount = stage === "twin" ? 1 : [mapLayers.ndvi, mapLayers.boundaries].filter(Boolean).length;

  // ⌘K / Ctrl+K toggles the coordinate search from anywhere; Esc closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="top-bar">
      <div className="top-bar-orbital-row">
        <div className="top-bar-brand">
          <div className="brand-agrox">
            <img
              src="/logos/agrox-blanco-completo.png"
              alt={es.app.name}
              className="brand-agrox-img"
              draggable={false}
            />
          </div>
          <span className="brand-divider" aria-hidden />
          <div className="brand-collab">
            <span className="brand-collab-label">EN COLABORACIÓN CON</span>
            <img
              src="/logos/spaceapp-blanco.png"
              alt="NASA Space Apps"
              className="brand-collab-img"
              draggable={false}
            />
          </div>
        </div>

        <div className="top-bar-right">
          <label className="date-range" title={pilot ? es.geo.pilotSeason : es.openParcel.seasonTitle}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
              <rect x="2.5" y="4" width="15" height="13.5" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2.5 8H17.5M6.5 2.2V5.2M13.5 2.2V5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>
              {fmtDate(start)} – {fmtDate(end)}
            </span>
            {pilot && (
              <select
                className="date-range-select-overlay"
                value={year}
                onChange={(e) => void loadSeason(Number(e.target.value))}
                aria-label={es.geo.pilotSeason}
              >
                {SEASONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
            <svg className="pill-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
              <path d="M4 6.2L8 10.2L12 6.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
          <span className="chip-button" title={es.layers.title}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
              <path d="M10 3L17.5 7L10 11L2.5 7L10 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M2.5 10.5L10 14.5L17.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.5 14L10 18L17.5 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{es.topbar.layers(layerCount)}</span>
            <svg className="pill-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
              <path d="M4 6.2L8 10.2L12 6.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <button
            type="button"
            className="icon-round"
            title={es.topbar.notifications}
            aria-label={es.topbar.notifications}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
              <path
                d="M10 3.2C7.3 3.2 5.2 5.3 5.2 8V11.6L3.6 13.6V14.4H16.4V13.6L14.8 11.6V8C14.8 5.3 12.7 3.2 10 3.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path d="M8.2 14.8C8.4 15.9 9.1 16.6 10 16.6C10.9 16.6 11.6 15.9 11.8 14.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
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
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
              <circle cx="10" cy="7" r="3.1" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4.5 16.2C5.4 13.5 7.5 12.2 10 12.2C12.5 12.2 14.6 13.5 15.5 16.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
        </div>
      </div>

      <div className="search-wrap">
        <button
          type="button"
          className="search"
          onClick={() => setSearchOpen(!searchOpen)}
          aria-expanded={searchOpen}
        >
          <svg className="search-icon" viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="search-placeholder">{es.point.search}, granja o región…</span>
          <kbd>{es.topbar.shortcut}</kbd>
        </button>
        {searchOpen && (
          <div className="search-pop" role="dialog">
            <PointSearch
              onSubmit={() => {
                setSearchOpen(false);
                useRotationView.getState().close();
                useModuleView.getState().close();
              }}
            />
          </div>
        )}
      </div>
    </header>
  );
}
