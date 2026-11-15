import type { LatLon } from "../types/parcel";
import { PILOT_FARM_ID } from "./parcel";

// ─────────────────────────────────────────
// Section: Parcel history (parcels the user opened or drew, kept in localStorage)
// ─────────────────────────────────────────

export interface ParcelRecord {
  farmId: string;
  // User-chosen name ("Parcela de Juan"); null = a default label derived from the id
  customName: string | null;
  createdAt: number;
  openedAt: number;
  areaHa: number | null;
  zoneCount: number | null;
  // [lat, lon]
  centroid: [number, number] | null;
  // Kept for drawn parcels so a poly_ id unknown to a restarted backend can be re-registered
  polygons: LatLon[][] | null;
}

const KEY = "agrox.parcels.v1";
export const MAX_PARCELS = 30;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is ParcelRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.farmId === "string" && typeof r.openedAt === "number" && typeof r.createdAt === "number";
}

export function loadHistory(store = storage()): ParcelRecord[] {
  try {
    const v: unknown = JSON.parse(store?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: ParcelRecord[], store = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(items));
  } catch {
    // blocked or full storage: the history still works for this session
  }
}

// Adds or refreshes a parcel (most recent first); keeps the original creation time, custom name and polygons
export function upsertParcel(
  items: ParcelRecord[],
  patch: Partial<ParcelRecord> & { farmId: string },
  now = Date.now(),
): ParcelRecord[] {
  const old = items.find((p) => p.farmId === patch.farmId);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = {
    customName: null,
    areaHa: null,
    zoneCount: null,
    centroid: null,
    polygons: null,
    ...old,
    ...defined,
    createdAt: old?.createdAt ?? now,
    openedAt: now,
  } as ParcelRecord;
  return [next, ...items.filter((p) => p.farmId !== patch.farmId)].slice(0, MAX_PARCELS);
}

// Updates figures without bumping "last opened" (used when the farm data arrives)
export function patchParcel(items: ParcelRecord[], farmId: string, patch: Partial<ParcelRecord>): ParcelRecord[] {
  return items.map((p) => (p.farmId === farmId ? { ...p, ...patch } : p));
}

export function defaultName(farmId: string, centroid: [number, number] | null): string {
  if (farmId === PILOT_FARM_ID) return "Granja piloto · Iowa";
  return centroid ? `Parcela ${centroid[0].toFixed(3)}, ${centroid[1].toFixed(3)}` : "Parcela sin nombre";
}

export function displayName(p: Pick<ParcelRecord, "farmId" | "customName" | "centroid">): string {
  return p.customName?.trim() || defaultName(p.farmId, p.centroid);
}
