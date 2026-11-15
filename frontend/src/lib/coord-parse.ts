import { PARCEL_LAT_MAX, PARCEL_LAT_MIN } from "./parcel";

// ─────────────────────────────────────────
// Section: Free-text coordinate parsing (decimal, DMS, Google Maps URLs)
// ─────────────────────────────────────────

export type CoordParse =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: "empty" | "format" | "lat-range" | "lon-range" };

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;

// Degrees, optional minutes and seconds, then the hemisphere letter (N/S/E/W, or O for Spanish "oeste")
const DMS_PART = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|'')\s*)?([NSEWO])`,
  "gi",
);

function fromDms(text: string): { lat: number; lon: number } | null {
  const found = [...text.replace(/,/g, " ").matchAll(DMS_PART)];
  if (found.length !== 2) return null;
  let lat: number | null = null;
  let lon: number | null = null;
  for (const m of found) {
    const value = Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
    const hemi = m[4]!.toUpperCase();
    const signed = hemi === "S" || hemi === "W" || hemi === "O" ? -value : value;
    if (hemi === "N" || hemi === "S") lat = signed;
    else lon = signed;
  }
  return lat === null || lon === null ? null : { lat, lon };
}

// Google Maps links: ".../@lat,lon,17z", "!3dlat!4dlon" (place pins) or "?q=lat,lon"
function fromUrl(text: string): { lat: number; lon: number } | null {
  if (!/^https?:\/\//i.test(text) && !text.includes("google.")) return null;
  const m =
    new RegExp(`!3d(${NUM})!4d(${NUM})`).exec(text) ??
    new RegExp(`@(${NUM}),(${NUM})`).exec(text) ??
    new RegExp(`[?&](?:q|ll|query)=(${NUM}),(${NUM})`).exec(text);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

// Two plain numbers separated by comma, semicolon or space; "20,73 -97,89" (decimal commas) also works
function fromDecimal(text: string): { lat: number; lon: number } | null {
  const m = new RegExp(String.raw`^(${NUM})\s*[,;\s]\s*(${NUM})$`).exec(text.trim());
  if (!m) return null;
  return { lat: Number(m[1]!.replace(",", ".")), lon: Number(m[2]!.replace(",", ".")) };
}

export function parseCoordinates(input: string): CoordParse {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty" };
  const pair = fromUrl(text) ?? fromDms(text) ?? fromDecimal(text);
  if (!pair || !Number.isFinite(pair.lat) || !Number.isFinite(pair.lon)) return { ok: false, reason: "format" };
  if (pair.lat < PARCEL_LAT_MIN || pair.lat > PARCEL_LAT_MAX) return { ok: false, reason: "lat-range" };
  if (Math.abs(pair.lon) > 180) return { ok: false, reason: "lon-range" };
  return { ok: true, lat: pair.lat, lon: pair.lon };
}
