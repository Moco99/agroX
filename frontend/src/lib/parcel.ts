import type { CropParams, LatLon } from "../types/parcel";

// ─────────────────────────────────────────
// Section: Parcel ids (pt_<lat>_<lon>) and latitude validity
// ─────────────────────────────────────────

export const PILOT_FARM_ID = "story_pilot_farm";

// The backend only synthesises parcels where Sentinel-2 and Copernicus DEM give usable coverage
export const PARCEL_LAT_MIN = -60;
export const PARCEL_LAT_MAX = 75;

export type LatCheck = { ok: true } | { ok: false; reason: "non-finite" | "south" | "north" };

export function checkParcelLat(lat: number): LatCheck {
  if (!Number.isFinite(lat)) return { ok: false, reason: "non-finite" };
  if (lat < PARCEL_LAT_MIN) return { ok: false, reason: "south" };
  if (lat > PARCEL_LAT_MAX) return { ok: false, reason: "north" };
  return { ok: true };
}

// Wrap longitudes that MapLibre reports past the antimeridian (e.g. 190 -> -170)
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// Two decimals (~1.1 km) is the id granularity of the guide: nearby clicks reuse the same cached parcel.
// Number() drops trailing zeros and the "-0" sign so ids stay canonical (30.8, not 30.80; 0, not -0).
function fixed2(v: number): string {
  const n = Number(v.toFixed(2));
  return String(Object.is(n, -0) ? 0 : n);
}

export function parcelIdFromPoint(point: LatLon): string | null {
  if (!checkParcelLat(point.lat).ok || !Number.isFinite(point.lon)) return null;
  return `pt_${fixed2(point.lat)}_${fixed2(wrapLon(point.lon))}`;
}

const PARCEL_RE = /^pt_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/;

export function parseParcelId(id: string): LatLon | null {
  const m = PARCEL_RE.exec(id);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!checkParcelLat(lat).ok || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function isPilotFarm(id: string): boolean {
  return id === PILOT_FARM_ID;
}

// A farm id the app accepts from a deep link: the pilot or a well-formed pt_ id
export function isValidFarmId(id: string | null): id is string {
  return id !== null && (isPilotFarm(id) || parseParcelId(id) !== null);
}

// ─────────────────────────────────────────
// Section: Deep link (?farm=<id>)
// ─────────────────────────────────────────

export function readFarmDeepLink(
  search: string | null = typeof window === "undefined" ? null : window.location.search,
): string | null {
  if (search === null) return null;
  const value = new URLSearchParams(search).get("farm");
  return isValidFarmId(value) ? value : null;
}

export function writeFarmDeepLink(farmId: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  // The pilot is the default, so it keeps the URL clean
  if (isPilotFarm(farmId)) url.searchParams.delete("farm");
  else url.searchParams.set("farm", farmId);
  window.history.replaceState(null, "", url);
}

// ─────────────────────────────────────────
// Section: Declared crop and planting date (DECLARED, persisted per farm in localStorage)
// ─────────────────────────────────────────

export interface Declaration {
  // zone_id -> catalog crop_id chosen by the user (absent = the farm's own crop)
  crops: Record<string, string>;
  // crop_id -> ISO planting date chosen by the user (absent = backend default)
  planting: Record<string, string>;
}

export const EMPTY_DECLARATION: Declaration = { crops: {}, planting: {} };

const STORAGE_PREFIX = "agrox.declaration.";

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string");
}

export function parseDeclaration(raw: string | null): Declaration {
  if (!raw) return EMPTY_DECLARATION;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && "crops" in v && "planting" in v) {
      const { crops, planting } = v as { crops: unknown; planting: unknown };
      if (isStringRecord(crops) && isStringRecord(planting)) return { crops, planting };
    }
  } catch {
    // corrupt entry: behave as if nothing was stored
  }
  return EMPTY_DECLARATION;
}

// Storage is injectable so tests do not depend on a DOM; every access is guarded (private mode, quota)
function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDeclaration(farmId: string, storage = defaultStorage()): Declaration {
  try {
    return parseDeclaration(storage?.getItem(STORAGE_PREFIX + farmId) ?? null);
  } catch {
    return EMPTY_DECLARATION;
  }
}

export function saveDeclaration(farmId: string, d: Declaration, storage = defaultStorage()): void {
  try {
    const empty = Object.keys(d.crops).length === 0 && Object.keys(d.planting).length === 0;
    if (empty) storage?.removeItem(STORAGE_PREFIX + farmId);
    else storage?.setItem(STORAGE_PREFIX + farmId, JSON.stringify(d));
  } catch {
    // persistence is a convenience; the declaration still works for this session
  }
}

// ─────────────────────────────────────────
// Section: Planting suggestion and season window
// ─────────────────────────────────────────

// Catalog windows are written for the northern hemisphere (Midwest); south of the equator the same window is
// six months later. This is a rough ESTIMATED suggestion the user can override, never a recommendation.
export function suggestPlantingDate(crop: Pick<CropParams, "planting_window">, lat: number, year: number): string {
  const [mm, dd] = crop.planting_window.start_mmdd.split("-").map(Number);
  const month = (mm ?? 5) - 1;
  const day = dd ?? 1;
  const shifted = lat < 0 ? (month + 6) % 12 : month;
  return new Date(Date.UTC(year, shifted, day)).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Simulation window around a declared planting date: a month of bare soil first, then the crop cycle plus a margin.
// Clamped to the weather coverage so the request never asks for days the provider cannot serve.
export function seasonWindow(planting: string, cycleDays: number, coverageEnd: string | null): { start: string; end: string } {
  const start = addDays(planting, -30);
  const end = addDays(planting, cycleDays + 20);
  return { start, end: coverageEnd && end > coverageEnd ? coverageEnd : end };
}

// Most recent planting date whose whole window is already behind the weather coverage; keeps defaults realistic
export function latestUsablePlanting(suggestMmdd: (year: number) => string, cycleDays: number, coverageEnd: string): string {
  const endYear = Number(coverageEnd.slice(0, 4));
  for (let y = endYear; y >= endYear - 3; y -= 1) {
    const candidate = suggestMmdd(y);
    if (addDays(candidate, Math.min(cycleDays, 120)) <= coverageEnd) return candidate;
  }
  return suggestMmdd(endYear - 1);
}

// ─────────────────────────────────────────
// Section: Backend capability
// ─────────────────────────────────────────

// Any-parcel needs the live data mode; servers that predate the explicit flag are judged by their mode alone
export function supportsAnyParcel(health: { data_mode: string; any_parcel_supported?: boolean } | null): boolean | null {
  if (!health) return null;
  if (typeof health.any_parcel_supported === "boolean") return health.any_parcel_supported && health.data_mode === "live";
  return health.data_mode === "live";
}
