import type { ClimateResponse, ObservationSeries, RegionMetric, RegionSummary } from "../types/api";

// ─────────────────────────────────────────
// Section: Region summary fallback (built from endpoints that already exist)
// ─────────────────────────────────────────

// Until GET /api/region/summary is served, the "Análisis de región" panel is assembled from two
// GET /api/climate calls (NASA POWER, MEASURED) and the MODIS NDVI series. Deltas are computed here
// only as plain differences of backend aggregates: no science, no estimation.

function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function sum(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

function metric(
  value: number | null,
  previous: number | null,
  unit: string,
  reference: string,
  source: string | null,
  dataState: RegionMetric["data_state"],
): RegionMetric {
  const delta = value !== null && previous !== null ? value - previous : null;
  const delta_pct = delta !== null && previous !== null && Math.abs(previous) > 1e-9 ? (delta / previous) * 100 : null;
  return { value, unit, delta, delta_pct, reference: previous !== null ? reference : "", data_state: dataState, source };
}

function withinPeriod(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function buildRegionFallback(args: {
  regionName: string;
  current: ClimateResponse;
  previous: ClimateResponse | null;
  previousLabel: string;
  modis: ObservationSeries | null;
  periodStart: string;
  periodEnd: string;
  previousStart: string | null;
  previousEnd: string | null;
}): RegionSummary {
  const { current, previous, modis } = args;
  const cur = current.series.days;
  const prev = previous?.series.days ?? [];
  const source = current.series.provenance.source;
  const state = current.series.provenance.data_state;
  const ref = args.previousLabel;

  // MODIS farm-level mean per composite date (zone rows averaged), restricted to each period
  const byDate = new Map<string, number[]>();
  for (const p of modis?.points ?? []) {
    if (p.value < 0) continue;
    const arr = byDate.get(p.date) ?? [];
    arr.push(p.value);
    byDate.set(p.date, arr);
  }
  const ndviSeries = Array.from(byDate.entries())
    .map(([date, vals]) => ({ date, value: mean(vals) ?? Number.NaN }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ndviNow = mean(ndviSeries.filter((p) => withinPeriod(p.date, args.periodStart, args.periodEnd)).map((p) => p.value));
  const ndviPrev =
    args.previousStart && args.previousEnd
      ? mean(ndviSeries.filter((p) => withinPeriod(p.date, args.previousStart ?? "", args.previousEnd ?? "")).map((p) => p.value))
      : null;

  const warnings = [...current.warnings, ...current.series.warnings];
  if (ndviPrev === null) warnings.push("NDVI sin periodo de referencia (MODIS disponible desde dic 2023)");
  if (!previous) warnings.push("Sin periodo anterior disponible en POWER para los deltas de clima");

  return {
    region_name: args.regionName,
    period_start: args.periodStart,
    period_end: args.periodEnd,
    previous_start: args.previousStart,
    previous_end: args.previousEnd,
    ndvi: metric(ndviNow, ndviPrev, "", ref, modis?.provenance.source ?? null, modis?.provenance.data_state ?? "MEASURED"),
    precipitation: metric(sum(cur.map((d) => d.precip)), prev.length ? sum(prev.map((d) => d.precip)) : null, "mm", ref, source, state),
    temperature: metric(mean(cur.map((d) => d.t_mean)), prev.length ? mean(prev.map((d) => d.t_mean)) : null, "°C", ref, source, state),
    radiation: metric(
      mean(cur.map((d) => d.solar_rad)),
      prev.length ? mean(prev.map((d) => d.solar_rad)) : null,
      "MJ/m²·día",
      ref,
      source,
      state,
    ),
    ndvi_series: ndviSeries,
    aptitude: null,
    aptitude_source: null,
    warnings,
    origin: "fallback",
  };
}

// Daily 2 m wind speed (m/s) on a date, used only as the amplitude of the crop sway animation
export function windOn(climate: ClimateResponse | null, date: string | undefined): number {
  if (!climate || !date) return 2;
  const day = climate.series.days.find((d) => d.date === date);
  return day ? day.wind_2m : 2;
}
