// ─────────────────────────────────────────
// Section: Rotation date presets and es-MX range validation (pure; "today" is injected)
// ─────────────────────────────────────────

export interface DateRange {
  start: string;
  end: string;
}

// Mirrors the backend limits (schemas/rotations.py)
export const MAX_PERIOD_DAYS = 731;
export const MAX_CYCLE_DAYS = 366;

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parse(iso: string): number {
  return ISO.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Number.NaN;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Inclusive day count; NaN when either date is missing or malformed
export function daysBetween(start: string, end: string): number {
  return (parse(end) - parse(start)) / DAY_MS + 1;
}

// Product presets, not agronomic claims: calendar halves of the northern-hemisphere year (equinox dates)
export function rotationPresets(year: number, today: string): { id: string; label: string; range: DateRange }[] {
  const last = parse(today);
  return [
    { id: "spring-summer", label: "Temporada primavera-verano", range: { start: `${year}-03-21`, end: `${year}-09-22` } },
    { id: "autumn-winter", label: "Otoño-invierno", range: { start: `${year}-09-23`, end: `${year + 1}-03-20` } },
    { id: "last-year", label: "Último año", range: { start: toIso(last - 364 * DAY_MS), end: today } },
  ];
}

export function periodError(start: string, end: string): string | null {
  if (!start || !end) return "Elige la fecha inicial y la final.";
  const n = daysBetween(start, end);
  if (!Number.isFinite(n)) return "Una de las fechas no es válida.";
  if (n < 1) return "La fecha final debe ser igual o posterior a la inicial.";
  if (n > MAX_PERIOD_DAYS) return `El periodo admite hasta ${MAX_PERIOD_DAYS} días (elegiste ${n}).`;
  return null;
}

export function windowsError(windows: DateRange[]): string | null {
  for (const [i, w] of windows.entries()) {
    if (!w.start || !w.end) return `Completa las fechas del ciclo ${i + 1}.`;
    const n = daysBetween(w.start, w.end);
    if (!Number.isFinite(n)) return `Las fechas del ciclo ${i + 1} no son válidas.`;
    if (n < 1) return `En el ciclo ${i + 1}, la fecha final debe ser igual o posterior a la inicial.`;
    if (n > MAX_CYCLE_DAYS) return `El ciclo ${i + 1} admite hasta ${MAX_CYCLE_DAYS} días (elegiste ${n}).`;
    const prev = windows[i - 1];
    if (prev && prev.end >= w.start) return `El ciclo ${i + 1} debe empezar después de que termine el ciclo ${i}.`;
  }
  const first = windows[0];
  const lastW = windows.at(-1);
  return first && lastW ? periodError(first.start, lastW.end) : null;
}

// Splits a period into `count` consecutive, non-overlapping windows so per-cycle dates start filled and valid
export function splitPeriod(start: string, end: string, count: number): DateRange[] {
  const total = daysBetween(start, end);
  if (!Number.isFinite(total) || total < count) return Array.from({ length: count }, () => ({ start: "", end: "" }));
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => {
    const from = parse(start) + i * base * DAY_MS;
    const to = i === count - 1 ? parse(end) : from + (base - 1) * DAY_MS;
    return { start: toIso(from), end: toIso(to) };
  });
}
