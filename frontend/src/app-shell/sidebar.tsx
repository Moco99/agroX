import { es } from "../i18n/es";
import { useTwinStore, type Screen } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Left navigation (only the two MVP screens are active)
// ─────────────────────────────────────────

interface NavItem {
  label: string;
  screen: Screen | null;
  icon: string;
}

const ITEMS: NavItem[] = [
  { label: es.nav.exploration, screen: null, icon: "◎" },
  { label: es.nav.vegetation, screen: "parcel", icon: "❦" },
  { label: es.nav.climate, screen: null, icon: "☀" },
  { label: es.nav.rotations, screen: null, icon: "↻" },
  { label: es.nav.scenarios, screen: "twin", icon: "◈" },
  { label: es.nav.reports, screen: null, icon: "▤" },
];

export function Sidebar() {
  const screen = useTwinStore((s) => s.screen);
  const setScreen = useTwinStore((s) => s.setScreen);
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-mark">▲</span>
        <div>
          <strong>{es.app.name}</strong>
          <small>{es.app.tagline}</small>
        </div>
      </div>
      <nav>
        {ITEMS.map((item) => {
          const disabled = item.screen === null;
          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${item.screen === screen ? " is-active" : ""}`}
              disabled={disabled}
              onClick={() => item.screen && setScreen(item.screen)}
              title={disabled ? es.nav.soon : item.label}
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
              {disabled && <small className="nav-soon">{es.nav.soon}</small>}
            </button>
          );
        })}
      </nav>
      <div className="ai-card">
        <strong>{es.nav.aiTitle}</strong>
        <p>{es.nav.aiBody}</p>
      </div>
    </aside>
  );
}
