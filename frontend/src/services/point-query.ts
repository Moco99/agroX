import { isRecord } from "../types/guards";

export const POINT_SECTIONS = [
  "coverage",
  "terrain",
  "soil",
  "climate",
  "vegetation",
  "suitability",
] as const;
export type PointSectionKey = (typeof POINT_SECTIONS)[number];
export interface PointSection {
  status: "ok" | "error";
  data: Record<string, unknown> | null;
  error: string | null;
  source: string;
  data_state: string;
  elapsed_s: number;
}
export interface PointRequest {
  lat: number;
  lon: number;
  start: string;
  end: string;
  refresh?: boolean;
}
export interface PointResponse {
  point: { lat: number; lon: number };
  period: { start: string; end: string };
  sections: Record<PointSectionKey, PointSection>;
}
export function isPointResponse(v: unknown): v is PointResponse {
  if (
    !isRecord(v) ||
    !isRecord(v.point) ||
    !isRecord(v.period) ||
    !isRecord(v.sections)
  )
    return false;
  if (
    typeof v.point.lat !== "number" ||
    !Number.isFinite(v.point.lat) ||
    Math.abs(v.point.lat) > 90 ||
    typeof v.point.lon !== "number" ||
    !Number.isFinite(v.point.lon) ||
    Math.abs(v.point.lon) > 180 ||
    typeof v.period.start !== "string" ||
    typeof v.period.end !== "string"
  )
    return false;
  return POINT_SECTIONS.every((key) => {
    const s = (v.sections as Record<string, unknown>)[key];
    return (
      isRecord(s) &&
      (s.status === "ok" || s.status === "error") &&
      (s.data === null || isRecord(s.data)) &&
      (s.error === null || typeof s.error === "string") &&
      typeof s.source === "string" &&
      typeof s.data_state === "string" &&
      typeof s.elapsed_s === "number" &&
      Number.isFinite(s.elapsed_s)
    );
  });
}
export async function queryPoint(
  body: PointRequest,
  signal: AbortSignal,
): Promise<PointResponse> {
  const response = await fetch("/api/points/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  // A proxy error page is HTML, not JSON: fall back to the HTTP status instead of a parse error
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      isRecord(result) && typeof result.detail === "string"
        ? result.detail
        : `HTTP ${response.status}`,
    );
  if (!isPointResponse(result)) throw new Error("Respuesta de punto inválida");
  return result;
}
