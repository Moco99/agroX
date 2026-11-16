import { es, fmt } from "../i18n/es";
import type { ProjectionRange, ProjectionScenario, TwinSimulateRequest } from "../types/api";

// ─────────────────────────────────────────
// Section: Opt-in CMIP6 climate for future windows (ADR-024); the default stays the historical reference year
// ─────────────────────────────────────────

export type ClimateChoice = "reference" | "projection";

export interface ProjectionChoice {
  scenario: ProjectionScenario;
}

export const PROJECTION_SCENARIOS: ProjectionScenario[] = ["ssp126", "ssp245", "ssp370"];
export const DEFAULT_SCENARIO: ProjectionScenario = "ssp245";
// Days the NASA POWER projection API serves (SSP runs); verified against the live API on 2026-11-15
export const PROJECTION_FIRST_DAY = "2015-01-01";
export const PROJECTION_LAST_DAY = "2100-12-31";

export function scenarioLabel(code: ProjectionScenario): string {
  return es.projection.scenarios[code];
}

export function projectionWindowError(start: string, end: string): string | null {
  return start < PROJECTION_FIRST_DAY || end > PROJECTION_LAST_DAY ? es.projection.outsideRange : null;
}

// Climate fields of a twin request: without a projection the request is exactly the historical one
export function climateFields(
  referenceYear: number | null,
  projection: ProjectionChoice | null,
): Pick<TwinSimulateRequest, "reference_year" | "climate_source" | "projection"> {
  if (!projection) return { reference_year: referenceYear };
  return { reference_year: null, climate_source: "projection", projection: { scenario: projection.scenario } };
}

export function rangeText(range: ProjectionRange): string {
  if (range.n_models < 2) return es.projection.singleModel;
  return es.projection.range(
    range.n_models,
    range.matured_models,
    range.stress_days_min,
    range.stress_days_max,
    fmt(range.season_precip_min_mm, 0),
    fmt(range.season_precip_max_mm, 0),
  );
}
