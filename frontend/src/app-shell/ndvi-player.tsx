import { useEffect } from "react";
import { es, fmtDate } from "../i18n/es";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: NDVI scene player (steps through the real Sentinel-2 dates; nothing is interpolated)
// ─────────────────────────────────────────

const STEP_MS = 900;

export function NdviPlayer({ withLabel = false }: { withLabel?: boolean }) {
  const dates = useTwinStore((s) => s.ndviDates);
  const date = useTwinStore((s) => s.ndviDate);
  const playing = useTwinStore((s) => s.ndviPlaying);
  const setDate = useTwinStore((s) => s.setNdviDate);
  const setPlaying = useTwinStore((s) => s.setNdviPlaying);
  const overlay = useTwinStore((s) => s.overlay);
  const contextLoaded = useTwinStore((s) => s.contextLoaded);
  // Without the dated endpoint the only scene is the provisional overlay; the player collapses to it
  const list = dates.length ? dates : overlay ? [overlay.date] : [];
  const index = Math.max(0, list.indexOf(date ?? ""));
  const n = list.length;

  useEffect(() => {
    if (!playing || n < 2) return;
    const id = setInterval(() => {
      const cur = useTwinStore.getState().ndviDate;
      const i = list.indexOf(cur ?? "");
      if (i >= n - 1) {
        setPlaying(false);
        return;
      }
      setDate(list[i + 1] ?? null);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, n, list, setDate, setPlaying]);

  if (n === 0) {
    return <div className="timeline muted">{contextLoaded ? es.map.noNdvi : es.globe.loadingRegion}</div>;
  }
  return (
    <div className="timeline ndvi-player">
      <button
        type="button"
        className="play-button"
        disabled={n < 2}
        onClick={() => {
          if (!playing && index >= n - 1) setDate(list[0] ?? null);
          setPlaying(!playing);
        }}
        aria-label={playing ? es.ndviPlayer.pause : es.ndviPlayer.play}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      {withLabel && <span className="timeline-label">{es.map.evolution}</span>}
      <div className="timeline-track dots">
        <input
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          value={index}
          onChange={(e) => setDate(list[Number(e.target.value)] ?? null)}
          aria-label={es.ndviPlayer.play}
        />
        <div className="timeline-dots" aria-hidden>
          {list.map((d, i) => (
            <i key={d} className={i <= index ? "is-past" : ""} style={{ left: `${(i / Math.max(1, n - 1)) * 100}%` }} />
          ))}
        </div>
      </div>
      <div className="timeline-date">
        <strong>{fmtDate(list[index])}</strong>
        <small>{es.ndviPlayer.scenes(n)}</small>
      </div>
      <button type="button" className="icon-button" disabled={index === 0} onClick={() => setDate(list[index - 1] ?? null)} aria-label={es.ndviPlayer.prev}>
        ‹
      </button>
      <button type="button" className="icon-button" disabled={index >= n - 1} onClick={() => setDate(list[index + 1] ?? null)} aria-label={es.ndviPlayer.next}>
        ›
      </button>
    </div>
  );
}
