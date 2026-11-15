import { useEffect, useMemo } from "react";
import { es, fmtDate } from "../i18n/es";
import { activeRun } from "../lib/derive";
import { stageMarks } from "../lib/stage-marks";
import { useTwinStore } from "../store/twin-store";

// ─────────────────────────────────────────
// Section: Stage timeline + player (steps through already computed states, never re-simulates)
// ─────────────────────────────────────────

const STEP_MS = 90;

export function Timeline() {
  const baseline = useTwinStore((s) => s.baseline);
  const scenario = useTwinStore((s) => s.scenario);
  const dayIndex = useTwinStore((s) => s.dayIndex);
  const playing = useTwinStore((s) => s.playing);
  const setDayIndex = useTwinStore((s) => s.setDayIndex);
  const setPlaying = useTwinStore((s) => s.setPlaying);
  const selectedZoneId = useTwinStore((s) => s.selectedZoneId);
  const run = activeRun(baseline, scenario);
  const zone = run?.zones.find((z) => z.zone_id === selectedZoneId) ?? run?.zones[0];
  const states = zone?.states ?? [];
  const n = states.length;

  useEffect(() => {
    if (!playing || n === 0) return;
    const id = setInterval(() => {
      const next = useTwinStore.getState().dayIndex + 1;
      if (next >= n) {
        setPlaying(false);
        return;
      }
      setDayIndex(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, n, setDayIndex, setPlaying]);

  // First day of each stage of the selected zone of the active run, placed by date inside that run's window
  const start = run?.start ?? states[0]?.date ?? "";
  const end = run?.end ?? states.at(-1)?.date ?? "";
  const milestones = useMemo(() => stageMarks(states, start, end), [states, start, end]);

  if (n === 0) return null;
  const current = states[Math.min(dayIndex, n - 1)];
  return (
    <div className="timeline">
      <button type="button" className="icon-button" onClick={() => setDayIndex(Math.max(0, dayIndex - 1))} aria-label={es.timeline.prev}>
        ◀
      </button>
      <button
        type="button"
        className="play-button"
        onClick={() => {
          if (!playing && dayIndex >= n - 1) setDayIndex(0);
          setPlaying(!playing);
        }}
        aria-label={playing ? es.timeline.pause : es.timeline.play}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button type="button" className="icon-button" onClick={() => setDayIndex(Math.min(n - 1, dayIndex + 1))} aria-label={es.timeline.next}>
        ▶
      </button>
      <div className="timeline-track" title={es.timeline.stageNote}>
        <input
          type="range"
          min={0}
          max={n - 1}
          value={Math.min(dayIndex, n - 1)}
          onChange={(e) => setDayIndex(Number(e.target.value))}
          aria-label={es.timeline.play}
        />
        <div className="timeline-milestones">
          {milestones.map((m) => (
            <button
              type="button"
              key={`${m.stage}-${m.index}`}
              className={`milestone${m.pct > 85 ? " is-end" : ""}`}
              style={{ left: `${m.pct}%` }}
              title={`${es.timeline.stages[m.stage]} · ${fmtDate(states[m.index]?.date)}`}
              aria-label={`${es.timeline.stages[m.stage]} · ${fmtDate(states[m.index]?.date)}`}
              onClick={() => setDayIndex(m.index)}
            >
              {m.labelled ? es.timeline.stages[m.stage] : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-date">
        <strong>{fmtDate(current?.date)}</strong>
        <small>{current ? es.timeline.stages[current.stage] : ""}</small>
      </div>
    </div>
  );
}
