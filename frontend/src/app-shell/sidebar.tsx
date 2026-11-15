import { useRotationView } from "../store/rotation-store";
import { es } from "../i18n/es";
import { useMapStore } from "../store/map-store";
import { usePointStore } from "../store/point-store";
import { useStageStore, type Stage } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Left navigation (menu items map to the three stages)
// ─────────────────────────────────────────

// Globe and farm share the same map, so moving between them is a camera flight; the twin is a separate scene
export function navigateTo(target: Stage): void {
  usePointStore.getState().close();
  useRotationView.getState().close();
  const { stage, goTo } = useStageStore.getState();
  if (target === "twin") {
    goTo("twin");
    return;
  }
  if (stage === "twin") goTo(target);
  // Queued even from the twin: the map replays the pending flight once it is mounted again
  useMapStore.getState().flyTo(target === "map" ? "pilot" : "globe");
}

interface NavItem {
  label: string;
  stage: Stage | null;
  rotation?: boolean;
  icon: string;
}

const ITEMS: NavItem[] = [
  { label: es.nav.exploration, stage: "globe", icon: "◎" },
  { label: es.nav.vegetation, stage: "map", icon: "❦" },
  { label: es.nav.climate, stage: null, icon: "☁" },
  { label: es.nav.rotations, stage: null, rotation: true, icon: "↻" },
  { label: es.nav.scenarios, stage: "twin", icon: "◈" },
  { label: es.nav.reports, stage: null, icon: "▤" },
];

export function Sidebar() {
  const stage = useStageStore((s) => s.stage);
  const rotationActive = useRotationView((s) => s.active);
  return (
    <aside className="sidebar">
      <div className="logo">
        <svg
          className="logo-mark"
          viewBox="0 0 32 32"
          aria-hidden
          width="30"
          height="30"
        >
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
          const disabled = item.stage === null && !item.rotation;
          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${(item.rotation ? rotationActive : !rotationActive && item.stage === stage) ? " is-active" : ""}`}
              disabled={disabled}
              onClick={() => {
                if (item.rotation) { usePointStore.getState().close(); useRotationView.getState().open(); }
                else if (item.stage) navigateTo(item.stage);
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
