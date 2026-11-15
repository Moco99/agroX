import { useModuleView } from "../store/module-store";
import { useRotationView } from "../store/rotation-store";
import { PointSearch } from "../screens/point/point-search";
import { useEffect, useState } from "react";
import { es, fmtDate } from "../i18n/es";
import { useStageStore } from "../store/stage-store";
import { useGuideStore } from "../store/guide-store";
import { isPilotFarm } from "../lib/parcel";
import { scenarioLabel } from "../lib/climate-projection";
import { displayName } from "../lib/parcel-history";
import { useHistoryStore } from "../store/history-store";
import { useParcelStore } from "../store/parcel-store";
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
  const guideOpen = useGuideStore((s) => s.open);
  const setGuideOpen = useGuideStore((s) => s.setOpen);
  const span = useTwinStore((s) => s.span);
  const farmId = useParcelStore((s) => s.farmId);
  const pilot = isPilotFarm(farmId);
  const record = useHistoryStore((s) => s.items.find((p) => p.farmId === farmId));
  const farm = useTwinStore((s) => s.farm)?.farm;
  // The loaded farm payload is the most accurate area; the history entry covers the time before it arrives
  const areaHa = farm?.farm_id === farmId ? farm.area_ha : (record?.areaHa ?? null);
  const parcelName = displayName({ farmId, customName: record?.customName ?? null, centroid: record?.centroid ?? null });
  const baseline = useTwinStore((s) => s.baseline);
  const referenceYear = useTwinStore((s) => s.referenceYear);
  const projection = useTwinStore((s) => s.projection);
  // The chip shows the window actually simulated for this parcel; the requested span only before a run exists
  const ran = baseline?.farm_id === farmId ? baseline : null;
  const start = ran?.start ?? span.start;
  const end = ran?.end ?? span.end;
  const season = seasonRange(year);
  const isSeason = start === season.start && end === season.end;
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
            {projection !== null ? es.topbar.simulatedProjection(scenarioLabel(projection.scenario)) : referenceYear !== null ? es.topbar.simulatedReference(referenceYear) : pilot ? "Iowa" : es.openParcel.seasonLabel} ·{" "}
            {fmtDate(start)} – {fmtDate(end)}
          </span>
          {pilot && (
            <select
              value={isSeason ? year : ""}
              onChange={(e) => void loadSeason(Number(e.target.value))}
              aria-label={es.geo.pilotSeason}
            >
              {/* A custom period (e.g. a future window) must not look like one of the observed seasons */}
              {!isSeason && <option value="" disabled>{es.topbar.customPeriod}</option>}
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
          className={`chip-button guide-button${guideOpen ? " is-active" : ""}`}
          title={es.guide.title}
          aria-label={es.guide.title}
          aria-expanded={guideOpen}
          data-testid="open-guide"
          onClick={() => setGuideOpen(!guideOpen)}
        >
          <span aria-hidden>ⓘ</span> {es.guide.open}
        </button>
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
