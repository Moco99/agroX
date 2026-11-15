import type { ReactNode } from "react";
import { useRotationView } from "../store/rotation-store";
import { es } from "../i18n/es";
import { useMapStore } from "../store/map-store";
import { usePointStore } from "../store/point-store";
import { useModuleView, type ModuleId } from "../store/module-store";
import { useStageStore, type Stage } from "../store/stage-store";

// ─────────────────────────────────────────
// Section: Left navigation (menu items map to the three stages + modules)
// ─────────────────────────────────────────

// Globe and farm share the same map, so moving between them is a camera flight; the twin is a separate scene
export function navigateTo(target: Stage): void {
  usePointStore.getState().close();
  useRotationView.getState().close();
  useModuleView.getState().close();
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
  module?: ModuleId;
  icon: ReactNode;
}

const ITEMS: NavItem[] = [
  {
    label: es.nav.exploration,
    stage: "globe",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.4" />
        <ellipse cx="10" cy="10" rx="3.4" ry="7.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3 10H17M4.2 6.8H15.8M4.2 13.2H15.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: es.nav.vegetation,
    stage: "map",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path d="M10 17V9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path
          d="M10 12C6.2 12 3.5 9.6 3.5 5.8C7.3 5.8 10 8.2 10 12Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M10 10.2C10 6.8 12.6 4.2 16.5 4.2C16.5 8 13.8 10.2 10 10.2Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: es.nav.climate,
    stage: null,
    module: "climate",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M6.2 14.8H14.2C16 14.8 17.4 13.5 17.4 11.7C17.4 10 16.1 8.7 14.5 8.6C13.9 6.1 11.7 4.4 9.1 4.4C6.1 4.4 3.7 6.8 3.7 9.8C3.7 10 3.7 10.2 3.8 10.4C2.9 10.9 2.4 11.8 2.4 12.8C2.4 13.9 3.3 14.8 4.5 14.8H6.2Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: es.nav.rotations,
    stage: null,
    rotation: true,
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M4.2 8.2C4.9 5.5 7.3 3.6 10.2 3.6C13 3.6 15.3 5.3 16.1 7.8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M16.4 4.8V8.1H13.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M15.8 11.8C15.1 14.5 12.7 16.4 9.8 16.4C7 16.4 4.7 14.7 3.9 12.2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M3.6 15.2V11.9H6.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: es.nav.scenarios,
    stage: "twin",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path d="M7.5 3.5H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path
          d="M8.5 3.5V7.8L4.4 14.4C3.8 15.4 4.5 16.6 5.7 16.6H14.3C15.5 16.6 16.2 15.4 15.6 14.4L11.5 7.8V3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M6.2 12.5H13.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: es.nav.reports,
    stage: null,
    module: "reports",
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <rect x="3.5" y="10.5" width="3" height="6" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
        <rect x="8.5" y="6.5" width="3" height="10" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
        <rect x="13.5" y="3.5" width="3" height="13" rx="0.8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const stage = useStageStore((s) => s.stage);
  const rotationActive = useRotationView((s) => s.active);
  const moduleActive = useModuleView((s) => s.active);
  return (
    <aside className="sidebar">
      <div className="sidebar-eyebrow">
        <span>{es.app.tagline.toUpperCase()}</span>
      </div>
      <nav>
        {ITEMS.map((item) => {
          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${(item.module ? moduleActive === item.module : item.rotation ? rotationActive : !rotationActive && !moduleActive && item.stage === stage) ? " is-active" : ""}`}
              onClick={() => {
                if (item.module) {
                  usePointStore.getState().close();
                  useRotationView.getState().close();
                  useModuleView.getState().open(item.module);
                } else if (item.rotation) {
                  usePointStore.getState().close();
                  useModuleView.getState().close();
                  useRotationView.getState().open();
                } else if (item.stage) navigateTo(item.stage);
              }}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="ai-card">
        <div className="ai-card-head">
          <span className="ai-spark" aria-hidden>
            ✦
          </span>
          <strong>{es.nav.aiTitle}</strong>
          <span className="ai-arrow" aria-hidden>
            →
          </span>
        </div>
        <p>{es.nav.aiBody}</p>
      </div>
    </aside>
  );
}
