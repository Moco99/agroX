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
// Section: Top bar (brand + NASA collaboration, search ⌘K, season range, layer count, notifications, help, avatar)
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
            <svg className="brand-agrox-mark" viewBox="0 0 36 36" width="28" height="28" aria-hidden>
              <defs>
                <linearGradient id="agroxWing" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#94b8e8" />
                </linearGradient>
              </defs>
              <path
                d="M18 3 L32 31 L24.5 31 L18 19.5 L11.5 31 L4 31 Z"
                fill="url(#agroxWing)"
              />
              <path d="M18 11 L23 22 L18 18.5 L13 22 Z" fill="#071022" />
              <path d="M6 26 Q18 15 30 22" fill="none" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <strong className="brand-agrox-name">{es.app.name}</strong>
          </div>
          <span className="brand-divider" aria-hidden />
          <div className="brand-collab">
            <span className="brand-collab-label">EN COLABORACIÓN CON</span>
            <svg className="nasa-meatball" viewBox="0 0 48 40" width="38" height="32" aria-label="NASA">
              <circle cx="23" cy="20" r="16" fill="#0b3d91" stroke="rgba(148, 197, 255, 0.35)" strokeWidth="0.8" />
              <circle cx="15" cy="11" r="0.7" fill="#ffffff" />
              <circle cx="18" cy="9" r="0.5" fill="#ffffff" />
              <circle cx="29" cy="11" r="0.7" fill="#ffffff" />
              <circle cx="31" cy="27" r="0.6" fill="#ffffff" />
              <circle cx="14" cy="28" r="0.6" fill="#ffffff" />
              <ellipse
                cx="23"
                cy="20"
                rx="18"
                ry="6.2"
                transform="rotate(-24 23 20)"
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.1"
              />
              <path
                d="M7 26 C18 17, 27 11, 41 6 C29 14, 21 21, 13 31 Z"
                fill="#fc3d21"
              />
              <path
                d="M19 6 C25 14, 29 22, 33 34 C28 24, 24 16, 17 8 Z"
                fill="#fc3d21"
              />
              <text
                x="23"
                y="22.5"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9.2"
                fontWeight="800"
                fontFamily="Georgia, 'Times New Roman', serif"
                letterSpacing="0.6"
              >
                NASA
              </text>
            </svg>
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
