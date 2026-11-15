import { create } from "zustand";
import type { LngLat } from "../lib/globe-view";
import { PILOT_CENTER } from "../lib/globe-view";
import {
  EMPTY_DECLARATION,
  isPilotFarm,
  loadDeclaration,
  parseParcelId,
  PILOT_FARM_ID,
  readFarmDeepLink,
  saveDeclaration,
  supportsAnyParcel,
  writeFarmDeepLink,
  type Declaration,
} from "../lib/parcel";
import type { Health } from "../types/api";
import type { CropCatalogLite } from "../types/parcel";

// ─────────────────────────────────────────
// Section: Active parcel (which farm every screen shows) and its loading progress
// ─────────────────────────────────────────

// Each source of a parcel is requested separately so the UI can say exactly which one is slow or failed
export const SOURCE_KEYS = ["farm", "ndvi", "climate", "imagery", "terrain", "simulation"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export type SourceState = "idle" | "pending" | "ok" | "error" | "skipped";

export interface SourceStatus {
  state: SourceState;
  message: string | null;
}

// idle: nothing requested · loading: first load in flight (30–90 s for a new parcel) · ready · error (a critical
// source failed) · cancelled: the user stopped it
export type LoadPhase = "idle" | "loading" | "ready" | "error" | "cancelled";

// unknown until /api/health answers
export type Capability = "unknown" | "supported" | "unsupported";

export function emptySources(): Record<SourceKey, SourceStatus> {
  return Object.fromEntries(SOURCE_KEYS.map((k) => [k, { state: "idle", message: null }])) as Record<SourceKey, SourceStatus>;
}

export function centerOf(farmId: string): LngLat {
  const p = parseParcelId(farmId);
  return p ? [p.lon, p.lat] : PILOT_CENTER;
}

interface ParcelStore {
  farmId: string;
  center: LngLat;
  phase: LoadPhase;
  sources: Record<SourceKey, SourceStatus>;
  startedAt: number | null;
  capability: Capability;
  declaration: Declaration;
  catalog: CropCatalogLite | null;
  // Switches the active parcel; returns false (and changes nothing) when the id is not acceptable
  setFarm: (farmId: string) => void;
  beginLoad: () => void;
  markSource: (key: SourceKey, state: SourceState, message?: string | null) => void;
  finishLoad: (phase: Extract<LoadPhase, "ready" | "error" | "cancelled">) => void;
  setHealth: (health: Health | null) => void;
  setCatalog: (catalog: CropCatalogLite | null) => void;
  setDeclaration: (d: Declaration) => void;
}

export const useParcelStore = create<ParcelStore>((set, get) => {
  // The deep link (?farm=) picks the starting parcel; anything invalid falls back to the pilot
  const initialId = readFarmDeepLink() ?? PILOT_FARM_ID;
  return {
    farmId: initialId,
    center: centerOf(initialId),
    phase: "idle",
    sources: emptySources(),
    startedAt: null,
    capability: "unknown",
    declaration: loadDeclaration(initialId),
    catalog: null,

    setFarm: (farmId) => {
      set({
        farmId,
        center: centerOf(farmId),
        phase: "idle",
        sources: emptySources(),
        startedAt: null,
        declaration: loadDeclaration(farmId),
      });
      writeFarmDeepLink(farmId);
    },

    beginLoad: () => {
      const sources = emptySources();
      for (const k of SOURCE_KEYS) sources[k] = { state: "pending", message: null };
      set({ phase: "loading", sources, startedAt: Date.now() });
    },

    markSource: (key, state, message = null) =>
      set((s) => ({ sources: { ...s.sources, [key]: { state, message } } })),

    finishLoad: (phase) => set({ phase }),

    setHealth: (health) => {
      const ok = supportsAnyParcel(health);
      set({ capability: ok === null ? "unknown" : ok ? "supported" : "unsupported" });
    },

    setCatalog: (catalog) => set({ catalog }),

    setDeclaration: (declaration) => {
      saveDeclaration(get().farmId, declaration);
      set({ declaration: declaration ?? EMPTY_DECLARATION });
    },
  };
});

export function activeIsPilot(): boolean {
  return isPilotFarm(useParcelStore.getState().farmId);
}
