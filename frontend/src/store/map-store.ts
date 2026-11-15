import { create } from "zustand";
import { GLOBE_VIEW, PILOT_VIEW, type CameraView } from "../lib/globe-view";
import { useParcelStore } from "./parcel-store";
import { useStageStore } from "./stage-store";

// ─────────────────────────────────────────
// Section: Geographic view state shared by the globe/map stages, the top bar and the point query
// ─────────────────────────────────────────

// "parcel" is the active parcel (the pilot until the user opens another one)
export type FlightTarget = "pilot" | "parcel" | "globe" | CameraView;

export interface FlightRequest {
  view: CameraView;
  // Monotonic id so the same destination can be requested twice in a row
  id: number;
}

export interface SelectedPoint {
  lat: number;
  lon: number;
}

interface MapStore {
  // Last settled camera; survives the map unmounting (twin stage) so coming back restores the view
  camera: CameraView;
  selected: SelectedPoint | null;
  flight: FlightRequest | null;
  // True once the user touched the globe; the idle rotation never restarts after that
  interacted: boolean;
  setCamera: (camera: CameraView) => void;
  select: (point: SelectedPoint | null) => void;
  // Asks the map to fly; the stage store tracks the flight phase so panels and overlays can react
  flyTo: (target: FlightTarget) => void;
  markInteracted: () => void;
  // The map clears the request once it starts flying so a later remount never replays an old trip
  consumeFlight: (id: number) => void;
}

let flightSeq = 0;

// Deep links to the farm or the twin start the camera at the farm so "back" lands on the polygons
export function initialCamera(stage = useStageStore.getState().stage): CameraView {
  return stage === "globe" ? GLOBE_VIEW : parcelView();
}

// Same framing as the pilot view, centred on whichever parcel is active
export function parcelView(): CameraView {
  return { ...PILOT_VIEW, center: useParcelStore.getState().center };
}

export function resolveFlight(target: FlightTarget): CameraView {
  if (target === "pilot") return PILOT_VIEW;
  if (target === "parcel") return parcelView();
  if (target === "globe") return GLOBE_VIEW;
  return target;
}

export const useMapStore = create<MapStore>((set) => ({
  camera: initialCamera(),
  selected: null,
  flight: null,
  interacted: false,
  setCamera: (camera) => set({ camera }),
  select: (selected) => set({ selected }),
  flyTo: (target) => {
    flightSeq += 1;
    set({ flight: { view: resolveFlight(target), id: flightSeq }, interacted: true });
    // Only a parcel (the pilot or an opened one) has a farm stage; any other destination is still "exploration"
    useStageStore.getState().startFlight(target === "pilot" || target === "parcel" ? "map" : "globe");
  },
  markInteracted: () => set({ interacted: true }),
  consumeFlight: (id) => set((s) => (s.flight?.id === id ? { flight: null } : {})),
}));
