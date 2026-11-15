import { checkParcelLat, parcelIdFromPoint, PILOT_FARM_ID } from "../lib/parcel";
import type { LatLon } from "../types/parcel";
import { useMapStore } from "./map-store";
import { useParcelStore } from "./parcel-store";
import { useTwinStore } from "./twin-store";

// ─────────────────────────────────────────
// Section: "Open any parcel" actions (the only place that switches the active farm)
// ─────────────────────────────────────────

export type OpenFailure = "latitude-south" | "latitude-north" | "invalid" | "unsupported";
export type OpenResult = { ok: true; farmId: string } | { ok: false; reason: OpenFailure };

// Why a point cannot become a parcel, without side effects; the panel uses it to disable the button and explain
export function canOpenAt(point: LatLon): OpenResult {
  const lat = checkParcelLat(point.lat);
  if (!lat.ok) {
    return { ok: false, reason: lat.reason === "south" ? "latitude-south" : lat.reason === "north" ? "latitude-north" : "invalid" };
  }
  const farmId = parcelIdFromPoint(point);
  if (!farmId) return { ok: false, reason: "invalid" };
  if (useParcelStore.getState().capability === "unsupported") return { ok: false, reason: "unsupported" };
  return { ok: true, farmId };
}

// Makes `farmId` active, flies there and loads it; re-opening the parcel that is already loading or loaded only flies
function activate(farmId: string, fly = true): void {
  const parcel = useParcelStore.getState();
  const same = parcel.farmId === farmId && (parcel.phase === "loading" || parcel.phase === "ready");
  if (!same) {
    parcel.setFarm(farmId);
    void useTwinStore.getState().init();
  }
  if (fly) useMapStore.getState().flyTo(farmId === PILOT_FARM_ID ? "pilot" : "parcel");
}

export function openParcelAt(point: LatLon): OpenResult {
  const check = canOpenAt(point);
  if (check.ok) activate(check.farmId);
  return check;
}

export function openPilot(): void {
  activate(PILOT_FARM_ID);
}

// Makes the pilot active without moving the camera (used when jumping straight to its twin)
export function selectPilot(): void {
  activate(PILOT_FARM_ID, false);
}

// Opens whichever parcel the app already considers active (deep link or last choice) at its own centre
export function retryActive(): void {
  void useTwinStore.getState().init();
}

export function cancelOpen(): void {
  useTwinStore.getState().cancelLoad();
}
