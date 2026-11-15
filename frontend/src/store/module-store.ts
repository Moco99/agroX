import { create } from "zustand";
import type { ClimateResponse } from "../types/api";
import type { RotationResponse } from "../screens/rotation/rotation-api";

// ─────────────────────────────────────────
// Section: Full-page modules (Clima, Informes) and the last rotation comparison shown by the report
// ─────────────────────────────────────────

export type ModuleId = "climate" | "reports" | "vegetation";

interface ModuleState {
  active: ModuleId | null;
  open: (m: ModuleId) => void;
  close: () => void;
  // Latest rotation comparison, kept here so the report can include it; scoped to its farm
  rotation: { farmId: string; baseline: RotationResponse; scenario: RotationResponse | null } | null;
  setRotation: (r: ModuleState["rotation"]) => void;
  // Last climate window fetched by the Clima module (scoped to its farm); the report prefers it over the twin window
  climate: { farmId: string; data: ClimateResponse } | null;
  setClimate: (c: ModuleState["climate"]) => void;
}

export const useModuleView = create<ModuleState>((set) => ({
  active: null,
  open: (active) => set({ active }),
  close: () => set({ active: null }),
  rotation: null,
  setRotation: (rotation) => set({ rotation }),
  climate: null,
  setClimate: (climate) => set({ climate }),
}));
