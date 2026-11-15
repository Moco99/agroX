import type { ObservationPoint } from "../types/api";

// ─────────────────────────────────────────
// Section: Vegetation analysis of NDVI series (pure; every output is an ESTIMATE from the series, not a field measurement)
// ─────────────────────────────────────────

// PRODUCT PARAMETERS: tuning choices of this UI, not agronomic or scientific constants. Each can be changed
// without touching the method; none was taken from a crop reference.
export const VEG_PARAMS = {
  // Observations whose clear-sky pixel share is below this are hidden (only when the source reports the share)
  minValidFraction: 0.5,
  // Green-up / senescence are the dates where NDVI crosses this fraction of the season amplitude (min to peak)
  amplitudeFraction: 0.5,
  // Below this peak-minus-minimum amplitude the year is reported as having no clear cycle
  minAmplitude: 0.15,
  // NDVI at or below this marks a bare-soil observation
  bareSoilMax: 0.2,
  // Same-date comparison: previous-year observations within this many days of today's day-of-year are used
  sameDateWindowDays: 10,
  // Difference (NDVI units) under which the current value is called "usual"
  usualBand: 0.05,
} as const;

export interface SeasonEvent {
  kind: "green_up" | "peak" | "senescence";
  date: string;
  value: number;
}

export interface BareSoilPeriod {
  start: string;
  end: string;
  observations: number;
}

export interface SeasonAnalysis {
  year: number;
  events: SeasonEvent[];
  bareSoil: BareSoilPeriod[];
  note: string | null;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// Drops observations the source itself marks as mostly clouded
export function clearPoints(points: ObservationPoint[], minValid: number = VEG_PARAMS.minValidFraction): ObservationPoint[] {
  return points.filter((p) => p.valid_fraction == null || p.valid_fraction >= minValid);
}

function dayOfYear(iso: string): number {
  const d = new Date(utc(iso));
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY_MS);
}

// Date of a linear crossing of `level` between two consecutive observations
function crossing(a: ObservationPoint, b: ObservationPoint, level: number): string {
  const t = b.value === a.value ? 0 : (level - a.value) / (b.value - a.value);
  const days = Math.round((t * (utc(b.date) - utc(a.date))) / DAY_MS);
  return new Date(utc(a.date) + days * DAY_MS).toISOString().slice(0, 10);
}

// Events of one zone-year: peak = highest observation; green-up / senescence = 50 % amplitude crossings either side of it
export function analyzeSeason(points: ObservationPoint[], year: number): SeasonAnalysis {
  const pts = points.filter((p) => p.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 3) return { year, events: [], bareSoil: [], note: "Hay muy pocas observaciones claras este año para estimar eventos." };
  const peak = pts.reduce((best, p) => (p.value > best.value ? p : best));
  const min = Math.min(...pts.map((p) => p.value));
  const bareSoil: BareSoilPeriod[] = [];
  let run: ObservationPoint[] = [];
  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first && last) bareSoil.push({ start: first.date, end: last.date, observations: run.length });
    run = [];
  };
  for (const p of pts) {
    if (p.value <= VEG_PARAMS.bareSoilMax) run.push(p);
    else flush();
  }
  flush();
  if (peak.value - min < VEG_PARAMS.minAmplitude) {
    return {
      year,
      events: [{ kind: "peak", date: peak.date, value: peak.value }],
      bareSoil,
      note: "La variación del año es pequeña: no se distingue un ciclo de crecimiento claro.",
    };
  }
  const level = min + VEG_PARAMS.amplitudeFraction * (peak.value - min);
  const events: SeasonEvent[] = [];
  const peakIdx = pts.indexOf(peak);
  for (let i = 1; i <= peakIdx; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b && a.value < level && b.value >= level) {
      events.push({ kind: "green_up", date: crossing(a, b, level), value: level });
      break;
    }
  }
  events.push({ kind: "peak", date: peak.date, value: peak.value });
  for (let i = peakIdx + 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b && a.value > level && b.value <= level) {
      events.push({ kind: "senescence", date: crossing(a, b, level), value: level });
      break;
    }
  }
  return { year, events, bareSoil, note: null };
}

export interface SameDateComparison {
  currentDate: string;
  current: number;
  previous: { year: number; value: number }[];
  mean: number | null;
  diff: number | null;
  verdict: "above" | "below" | "usual" | "no_history";
}

// Latest observation vs the mean of earlier years around the same day-of-year
export function compareWithPreviousYears(points: ObservationPoint[]): SameDateComparison | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  if (!latest) return null;
  const year = Number(latest.date.slice(0, 4));
  const doy = dayOfYear(latest.date);
  const previous: { year: number; value: number }[] = [];
  for (const y of new Set(sorted.map((p) => Number(p.date.slice(0, 4))))) {
    if (y >= year) continue;
    const near = sorted
      .filter((p) => p.date.startsWith(`${y}-`) && Math.abs(dayOfYear(p.date) - doy) <= VEG_PARAMS.sameDateWindowDays)
      .sort((a, b) => Math.abs(dayOfYear(a.date) - doy) - Math.abs(dayOfYear(b.date) - doy))[0];
    if (near) previous.push({ year: y, value: near.value });
  }
  const base = { currentDate: latest.date, current: latest.value, previous };
  if (previous.length === 0) return { ...base, mean: null, diff: null, verdict: "no_history" };
  const mean = previous.reduce((s, p) => s + p.value, 0) / previous.length;
  const diff = latest.value - mean;
  const verdict = Math.abs(diff) <= VEG_PARAMS.usualBand ? "usual" : diff > 0 ? "above" : "below";
  return { ...base, mean, diff, verdict };
}

export function verdictText(c: SameDateComparison | null): string {
  if (!c) return "Sin observaciones para interpretar.";
  if (c.verdict === "no_history") return "Aún no hay años anteriores en la serie para comparar las mismas fechas.";
  const n = c.previous.length;
  const base = `Frente a ${n} ${n === 1 ? "año anterior" : "años anteriores"} en fechas parecidas`;
  if (c.verdict === "usual") return `${base}, la vegetación está en un nivel cercano a lo usual.`;
  return `${base}, la vegetación está ${c.verdict === "above" ? "por encima" : "por debajo"} de lo usual.`;
}

export const EVENT_LABELS: Record<SeasonEvent["kind"], string> = {
  green_up: "Inicio de verdor",
  peak: "Máximo de vegetación",
  senescence: "Inicio de senescencia",
};
