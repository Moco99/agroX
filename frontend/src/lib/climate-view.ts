import type { ClimateMetric, DataState } from "../types/api";
import { isRecord } from "../types/guards";
import { spiLabel } from "./readings";

export { spiLabel };

// ─────────────────────────────────────────
// Section: Climate indicators helpers (pure; the backend computes every number)
// ─────────────────────────────────────────

// Backend limit of /api/climate per query
export const MAX_CLIMATE_DAYS = 800;

const STATES = new Set<string>(["MEASURED", "DECLARED", "ESTIMATED", "SIMULATED", "SYNTHETIC"]);

// Indicators arrive as an untyped record: keep only well-formed metrics
export function metricOf(indicators: Record<string, unknown>, key: string): ClimateMetric | null {
  const m = indicators[key];
  if (!isRecord(m) || typeof m.unit !== "string" || typeof m.data_state !== "string" || !STATES.has(m.data_state)) return null;
  const value = typeof m.value === "number" && Number.isFinite(m.value) ? m.value : null;
  return { value, unit: m.unit, data_state: m.data_state as DataState, source: typeof m.source === "string" ? m.source : null };
}

// Backend units are terse codes ("C", "C-day", "days"); the UI shows the conventional symbol instead
const UNIT_SYMBOL: Record<string, string> = { C: "°C", "C-day": "°C·día", days: "días", index: "" };

export function unitSymbol(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_SYMBOL[unit] ?? unit;
}

// Plain numeric fields of the indicator record (thresholds the backend publishes, e.g. gdd_base_c)
export function numberOf(indicators: Record<string, unknown>, key: string): number | null {
  const v = indicators[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Inclusive day count; NaN when a date is invalid
export function windowDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

// Returns an es-MX message when the window cannot be requested, null when valid
export function windowError(start: string, end: string): string | null {
  const n = windowDays(start, end);
  if (!Number.isFinite(n)) return "Elige fechas válidas.";
  if (n < 1) return "La fecha final debe ser igual o posterior a la inicial.";
  if (n > MAX_CLIMATE_DAYS) return `La ventana admite hasta ${MAX_CLIMATE_DAYS} días (elegiste ${n}).`;
  return null;
}

export function spiExplanation(spi: number | null): string {
  if (spi === null)
    return "No hay suficientes años de referencia para calcular el SPI de esta ventana; no se estima un valor.";
  return `El SPI compara la lluvia de la ventana con la de los mismos días en otros años. Con ${spi.toFixed(2)} el periodo es ${spiLabel(spi)}. Cerca de 0 es normal; por debajo de −1 es seco y por encima de +1 es húmedo.`;
}

export function anomalyExplanation(pct: number | null): string {
  if (pct === null)
    return "La anomalía necesita al menos 10 años de referencia de la misma ventana; sin ellos no se muestra un valor.";
  const dir = pct >= 0 ? "más" : "menos";
  return `Llovió ${Math.abs(pct).toFixed(1)} % ${dir} que el promedio de los mismos días en otros años.`;
}
