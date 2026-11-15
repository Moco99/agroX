import { useModuleView } from "../store/module-store";
import { useRotationView } from "../store/rotation-store";
import { PointSearch } from "../screens/point/point-search";
import { useEffect, useState } from "react";
import { es, fmtDate } from "../i18n/es";
import { useStageStore } from "../store/stage-store";
import { isPilotFarm } from "../lib/parcel";
import { displayName } from "../lib/parcel-history";
import { useHistoryStore } from "../store/history-store";
import { useParcelStore } from "../store/parcel-store";
import { SEASONS, useTwinStore } from "../store/twin-store";

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
  const span = useTwinStore((s) => s.span);
  const farmId = useParcelStore((s) => s.farmId);
  const pilot = isPilotFarm(farmId);
  const record = useHistoryStore((s) => s.items.find((p) => p.farmId === farmId));
  const farm = useTwinStore((s) => s.farm)?.farm;
  // The loaded farm payload is the most accurate area; the history entry covers the time before it arrives
  const areaHa = farm?.farm_id === farmId ? farm.area_ha : (record?.areaHa ?? null);
  const parcelName = displayName({ farmId, customName: record?.customName ?? null, centroid: record?.centroid ?? null });
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
      <div className="search-wrap">
        <button
          type="button"
          className="search"
          onClick={() => setSearchOpen(!searchOpen)}
          aria-expanded={searchOpen}
        >
          <span aria-hidden>⌕</span>
          <span className="search-placeholder">{es.point.search}</span>
          <kbd>{es.topbar.shortcut}</kbd>
        </button>
        {searchOpen && (
          <div className="search-pop" role="dialog">
            <PointSearch onSubmit={() => { setSearchOpen(false); useRotationView.getState().close(); useModuleView.getState().close(); }} />
          </div>
        )}
      </div>
      <div className="top-bar-right">
        <span className="chip-button parcel-chip" title={es.history.current} data-testid="current-parcel">
          <span aria-hidden>⬚</span>
          <strong>{parcelName}</strong>
          {areaHa !== null && <span>· {areaHa.toFixed(1)} ha</span>}
        </span>
        <label className="date-range" title={pilot ? es.geo.pilotSeason : es.openParcel.seasonTitle}>
          <span aria-hidden>▦</span>
          <span>
            {pilot ? "Iowa" : es.openParcel.seasonLabel} · {fmtDate(start)} – {fmtDate(end)}
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
        </label>
        <span className="chip-button" title={es.layers.title}>
          <span aria-hidden>▤</span> {es.topbar.layers(layerCount)}
        </span>
        <button
          type="button"
          className="icon-round"
          title={es.topbar.notifications}
          aria-label={es.topbar.notifications}
        >
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
