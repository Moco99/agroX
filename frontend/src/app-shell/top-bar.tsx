import { es, fmtDate } from "../i18n/es";
import { SEASONS, seasonRange, useTwinStore } from "../store/twin-store";

export function TopBar() {
  const year = useTwinStore((s) => s.year);
  const loadSeason = useTwinStore((s) => s.loadSeason);
  const { start, end } = seasonRange(year);
  return (
    <header className="top-bar">
      <div className="search" aria-label={es.topbar.search}>
        <span aria-hidden>⌕</span> {es.topbar.search}
      </div>
      <div className="top-bar-right">
        <label className="season-select">
          {es.topbar.season}
          <select value={year} onChange={(e) => void loadSeason(Number(e.target.value))}>
            {SEASONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="date-range">
          {es.topbar.period}: {fmtDate(start)} – {fmtDate(end)}
        </span>
      </div>
    </header>
  );
}
