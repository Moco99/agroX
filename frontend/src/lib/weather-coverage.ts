import { isRecord } from "../types/guards";
import { es } from "../i18n/es";

export interface WeatherCoverage {
  start: string;
  end: string;
  available_days: number;
  missing: Array<{ start: string; end: string }>;
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
