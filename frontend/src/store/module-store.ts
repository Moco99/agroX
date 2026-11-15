import { create } from "zustand";
import type { RotationResponse } from "../screens/rotation/rotation-api";

// ─────────────────────────────────────────
// Section: Full-page modules (Clima, Informes) and the last rotation comparison shown by the report
// ─────────────────────────────────────────

export type ModuleId = "climate" | "reports";

interface ModuleState {
  active: ModuleId | null;
  open: (m: ModuleId) => void;
  close: () => void;
  // Latest rotation comparison, kept here so the report can include it; scoped to its farm
  rotation: { farmId: string; baseline: RotationResponse; scenario: RotationResponse | null } | null;
  setRotation: (r: ModuleState["rotation"]) => void;
}

export const useModuleView = create<ModuleState>((set) => ({
  active: null,
  open: (active) => set({ active }),
  close: () => set({ active: null }),
  rotation: null,
  setRotation: (rotation) => set({ rotation }),
}));
