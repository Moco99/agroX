import { es } from "../i18n/es";
import { useStageStore, type Stage } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Left navigation (menu items map to the three cinematic stages)
// ─────────────────────────────────────────

interface NavItem {
  label: string;
  stage: Stage | null;
  icon: string;
}

const ITEMS: NavItem[] = [
  { label: es.nav.exploration, stage: "globe", icon: "◎" },
  { label: es.nav.vegetation, stage: "map", icon: "❦" },
  { label: es.nav.climate, stage: null, icon: "☁" },
  { label: es.nav.rotations, stage: null, icon: "↻" },
  { label: es.nav.scenarios, stage: "twin", icon: "◈" },
  { label: es.nav.reports, stage: null, icon: "▤" },
];

export function Sidebar() {
  const stage = useStageStore((s) => s.stage);
  const goTo = useStageStore((s) => s.goTo);
  const cancelAutopilot = useStageStore((s) => s.cancelAutopilot);
  return (
    <aside className="sidebar">
      <div className="logo">
        <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden width="30" height="30">
          <path d="M4 24 L16 6 L28 24 Z" fill="#7EE36D" />
          <path d="M10 24 L16 14 L22 24 Z" fill="#107432" />
        </svg>
        <div>
          <strong>{es.app.name}</strong>
          <small>{es.app.tagline}</small>
        </div>
      </div>
      <nav>
        {ITEMS.map((item) => {
          const disabled = item.stage === null;
          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${item.stage === stage ? " is-active" : ""}`}
              disabled={disabled}
              onClick={() => {
                if (!item.stage) return;
                cancelAutopilot();
                // Jumping backwards is instant; moving forward keeps the cinematic transition
                goTo(item.stage, { instant: item.stage === "globe" || (item.stage === "map" && stage === "twin") });
              }}
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
        <span className="ai-spark" aria-hidden>
          ✦
        </span>
        <div>
          <strong>{es.nav.aiTitle}</strong>
          <p>{es.nav.aiBody}</p>
        </div>
      </div>
    </aside>
  );
}
