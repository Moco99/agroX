import { isRecord } from "../types/guards";
import { es } from "../i18n/es";

export interface WeatherCoverage {
  start: string;
  end: string;
  available_days: number;
  missing: Array<{ start: string; end: string }>;
  // Calendar years usable as historical reference (optional: older backends omit them)
  complete_years?: number[];
  latest_complete_year?: number | null;
  max_filled_gap_days?: number;
}

// Reference years offered to the user: complete years (newest first), plus the partial last year whose
// missing future days the backend takes from the previous year
export function referenceOptions(coverage: WeatherCoverage): Array<{ year: number; complete: boolean }> {
  const complete = [...(coverage.complete_years ?? [])].sort((a, b) => b - a);
  const lastYear = Number(coverage.end.slice(0, 4));
  const partial = complete.includes(lastYear) ? [] : [{ year: lastYear, complete: false }];
  return [...partial, ...complete.map((year) => ({ year, complete: true }))];
}

export async function getWeatherCoverage(farmId: string, signal: AbortSignal): Promise<WeatherCoverage> {
  const response = await fetch(`/api/farms/${encodeURIComponent(farmId)}/weather/coverage`, { signal });
  const value: unknown = await response.json();
  if (!response.ok || !isRecord(value) || typeof value.start !== "string" || typeof value.end !== "string" ||
      typeof value.available_days !== "number" || !Array.isArray(value.missing) ||
      !value.missing.every((gap: unknown) => isRecord(gap) && typeof gap.start === "string" && typeof gap.end === "string")) {
    throw new Error(es.weatherReference.unavailable);
  }
  return value as unknown as WeatherCoverage;
}
