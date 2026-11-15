import { es } from "../i18n/es";

// ─────────────────────────────────────────
// Section: Floating canvas controls (zoom, locate, fullscreen) shared by the three stages
// ─────────────────────────────────────────

interface CanvasControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  fullscreenTarget?: () => HTMLElement | null;
}

export function CanvasControls({ onZoomIn, onZoomOut, onLocate, fullscreenTarget }: CanvasControlsProps) {
  const fullscreen = () => {
    const el = fullscreenTarget?.();
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  return (
    <div className="canvas-controls">
      <button type="button" onClick={onZoomIn} aria-label={es.controls.zoomIn} title={es.controls.zoomIn}>
        +
      </button>
      <button type="button" onClick={onZoomOut} aria-label={es.controls.zoomOut} title={es.controls.zoomOut}>
        −
      </button>
      <button type="button" onClick={onLocate} aria-label={es.controls.locate} title={es.controls.locate}>
        ➤
      </button>
      {fullscreenTarget && (
        <button type="button" onClick={fullscreen} aria-label={es.controls.fullscreen} title={es.controls.fullscreen}>
          ⛶
        </button>
      )}
    </div>
  );
}

export function ScaleBar({ label, px = 90 }: { label: string; px?: number }) {
  return (
    <div className="scale-bar" style={{ width: px }}>
      <span>{label}</span>
    </div>
  );
}
