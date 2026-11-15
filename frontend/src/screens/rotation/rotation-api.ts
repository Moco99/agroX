import { isRecord } from "../../types/guards";

export interface RotationWindow { start: string; end: string }

export interface RotationRequest {
  farm_id: string;
  start: string;
  end: string;
  reference_year?: number | null;
  cycles: number;
  top_k: number;
  cycle_windows?: RotationWindow[];
  twin_only?: boolean;
  previous_crop?: string;
  start_crop?: string;
  exclude_same_family: boolean;
  scenario: { temp_delta_c: number; precip_factor: number };
  soil_ph?: number;
  weights: { water: number; soil: number; climate: number };
}

export interface RotationCycle {
  cycle: number;
  crop_id: string;
  name: string;
  rainfall_fit: number;
  temperature_fit: number;
  ph_fit: number | null;
  family: string;
  data_state: string;
  window?: RotationWindow;
  twin_supported?: boolean;
  warnings: string[];
}
export interface RotationRecommendation {
  sequence: string[];
  overall_score: number;
  score?: number;
  family_repeats?: number;
  agroclimatic_score?: number;
  rotation?: { index: number };
  rotation_weight?: number;
  explanation?: string[];
  cycles: RotationCycle[];
  warnings: string[];
  score_type: string;
  field_validated: boolean;
  indicators: { water: number | null; soil: number | null; climate: number | null };
  weights: { water: number; soil: number; climate: number };
}
export interface RotationResponse {
  recommendations: RotationRecommendation[];
  warnings: string[];
  inputs: Record<string, unknown>;
  methodology: string;
  data_state: string;
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const optionalNumber = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isFinite(v));
function isCycle(v: unknown): v is RotationCycle {
  return isRecord(v) && typeof v.cycle === "number" && typeof v.crop_id === "string" &&
    typeof v.name === "string" && typeof v.rainfall_fit === "number" && Number.isFinite(v.rainfall_fit) &&
    typeof v.temperature_fit === "number" && Number.isFinite(v.temperature_fit) && (v.ph_fit === null || typeof v.ph_fit === "number") && typeof v.family === "string" &&
    typeof v.data_state === "string" &&
    (v.twin_supported === undefined || typeof v.twin_supported === "boolean") &&
    (v.window === undefined || (isRecord(v.window) && typeof v.window.start === "string" && typeof v.window.end === "string")) &&
    strings(v.warnings);
}
function isRecommendation(v: unknown): v is RotationRecommendation {
  return isRecord(v) && isRecord(v.weights) && typeof v.weights.water === "number" && typeof v.weights.soil === "number" && typeof v.weights.climate === "number" && isRecord(v.indicators) && [v.indicators.water, v.indicators.soil, v.indicators.climate].every((x) => x === null || (typeof x === "number" && Number.isFinite(x))) && strings(v.sequence) && typeof v.overall_score === "number" && Number.isFinite(v.overall_score) &&
    (v.score === undefined || (typeof v.score === "number" && Number.isFinite(v.score))) &&
    // Rotation component fields are optional (older responses lack them) but must be well-formed when present
    optionalNumber(v.agroclimatic_score) && optionalNumber(v.rotation_weight) &&
    (v.rotation === undefined || (isRecord(v.rotation) && typeof v.rotation.index === "number" && Number.isFinite(v.rotation.index))) &&
    (v.explanation === undefined || strings(v.explanation)) &&
    Array.isArray(v.cycles) && v.cycles.every(isCycle) && strings(v.warnings) &&
    typeof v.score_type === "string" && typeof v.field_validated === "boolean";
}
export async function recommendRotation(request: RotationRequest, signal: AbortSignal): Promise<RotationResponse> {
  const response = await fetch("/api/rotations/recommend", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(value) ? value.detail : null;
    const validation = Array.isArray(detail) ? detail.find((entry) => isRecord(entry) && typeof entry.msg === "string") : null;
    // Pydantic loc is ["body", "weights", "x"]; naming the field makes "Extra inputs..." actionable
    const loc = isRecord(validation) && Array.isArray(validation.loc)
      ? validation.loc.filter((part) => part !== "body").join(".") : "";
    const message = typeof detail === "string" ? detail
      : isRecord(validation) && typeof validation.msg === "string"
        ? `${validation.msg.replace(/^Value error, /, "")}${loc ? ` (campo: ${loc})` : ""}`
      : `No se pudo calcular el ranking (HTTP ${response.status}).`;
    throw new Error(message);
  }
  if (!isRecord(value) || !Array.isArray(value.recommendations) || !value.recommendations.every(isRecommendation)) {
    throw new Error("La respuesta de rotaciones tiene un formato inesperado.");
  }
  return {
    recommendations: value.recommendations,
    warnings: strings(value.warnings) ? value.warnings : [],
    inputs: isRecord(value.inputs) ? value.inputs : {},
    methodology: typeof value.methodology === "string" ? value.methodology : "EcoCrop",
    data_state: typeof value.data_state === "string" ? value.data_state : "ESTIMATED",
  };
}
