import { create } from "zustand";
import { addVertex, EMPTY_DRAW, finishPolygon, undo, type DrawState } from "../lib/draw";
import type { LatLon } from "../types/parcel";

// ─────────────────────────────────────────
// Section: Drawing mode of the map (user-drawn parcels; logic lives in lib/draw)
// ─────────────────────────────────────────

interface DrawStore extends DrawState {
  // While active, map clicks place vertices instead of selecting a point
  active: boolean;
  setActive: (active: boolean) => void;
  add: (p: LatLon, nearFirst: boolean) => void;
  undo: () => void;
  finish: () => void;
  clear: () => void;
}

const pick = (s: DrawState): DrawState => ({ polygons: s.polygons, current: s.current });

export const useDrawStore = create<DrawStore>((set) => ({
  ...EMPTY_DRAW,
  active: false,
  setActive: (active) => set({ active }),
  add: (p, nearFirst) => set((s) => addVertex(pick(s), p, nearFirst)),
  undo: () => set((s) => undo(pick(s))),
  finish: () => set((s) => finishPolygon(pick(s))),
  clear: () => set({ ...EMPTY_DRAW }),
}));
