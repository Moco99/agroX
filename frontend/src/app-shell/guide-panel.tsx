import { useEffect, useMemo, useRef, useState } from "react";
import { DataStateLegend } from "../components/explain/data-state-legend";
import { ReadingChip } from "../components/explain/reading-chip";
import { es } from "../i18n/es";
import type { Tone } from "../lib/readings";
import { useGuideStore } from "../store/guide-store";

// ─────────────────────────────────────────
// Section: Quick guide + glossary (in-app, always one click away from the top bar)
// ─────────────────────────────────────────

const TONES: Tone[] = ["good", "warn", "bad", "neutral"];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Accent-insensitive match so "indice" finds "índice" on any keyboard
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function GuideContent() {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const q = normalize(query.trim());
    return Object.entries(es.glossary)
      .filter(([, e]) => !q || normalize(`${e.term} ${e.text}`).includes(q))
      .sort(([, a], [, b]) => a.term.localeCompare(b.term, "es"));
  }, [query]);
  return (
    <div className="guide-body">
      <section>
        <h4>{es.guide.stepsTitle}</h4>
        <ol>
          {es.guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
      <section className="model-note" role="note">
        <strong>{es.modelNote.title}</strong>
        <p>{es.modelNote.body}</p>
        <p>{es.modelNote.score}</p>
      </section>
      <section>
        <h4>{es.guide.colorsTitle}</h4>
        <ul className="guide-colors">
          {TONES.map((t) => (
            <li key={t}>
              <ReadingChip reading={{ tone: t, label: es.tones[t] }} /> {es.guide.colors[t]}
            </li>
          ))}
        </ul>
        <small className="muted">{es.guide.colorsNote}</small>
      </section>
      <DataStateLegend open />
      <section>
        <h4>{es.glossaryTitle}</h4>
        <input
          type="search"
          className="guide-search"
          placeholder={es.guide.search}
          aria-label={es.guide.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {entries.length === 0 ? (
          <p className="muted">{es.guide.noMatch}</p>
        ) : (
          <dl className="glossary-list">
            {entries.map(([id, e]) => (
              <div key={id}>
                <dt>{e.term}</dt>
                <dd>{e.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

export function GuidePanel() {
  const open = useGuideStore((s) => s.open);
  const setOpen = useGuideStore((s) => s.setOpen);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Modal dialog contract: focus moves in on open, Tab cycles inside, Esc closes and focus returns to the opener
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="guide-scrim" onClick={() => setOpen(false)}>
      <div
        ref={panelRef}
        className="guide-panel"
        role="dialog"
        aria-modal="true"
        aria-label={es.guide.title}
        onClick={(e) => e.stopPropagation()}
        data-testid="guide-panel"
      >
        <div className="card-head">
          <h3>{es.guide.title}</h3>
          <button ref={closeRef} type="button" className="icon-button" onClick={() => setOpen(false)} aria-label={es.guide.close}>
            ✕
          </button>
        </div>
        <GuideContent />
      </div>
    </div>
  );
}
