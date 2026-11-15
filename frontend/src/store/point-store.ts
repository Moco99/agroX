import { create } from "zustand";
import { queryPoint, type PointRequest, type PointResponse } from "../services/point-query";

// ─────────────────────────────────────────
// Section: Point query (POST /api/points/query) shown as an overlay above the map
// ─────────────────────────────────────────

// Module-level so a new query aborts the previous one even if the overlay was closed in between
let controller: AbortController | null = null;

interface PointStore {
  // Overlay visible; the map underneath stays mounted so closing it keeps the camera and the tile cache
  active: boolean;
  loading: boolean;
  result: PointResponse | null;
  error: string | null;
  request: PointRequest | null;
  query: (request: PointRequest) => Promise<void>;
  cancel: () => void;
  close: () => void;
}

export const usePointStore = create<PointStore>((set, get) => ({
  active: false,
  loading: false,
  result: null,
  error: null,
  request: null,
  query: async (request) => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    set({ active: true, loading: true, result: null, error: null, request });
    try {
      const result = await queryPoint(request, current.signal);
      if (controller === current && !current.signal.aborted) set({ result, loading: false });
    } catch (error) {
      if (controller === current && !current.signal.aborted)
        set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
  cancel: () => {
    controller?.abort();
    controller = null;
    set({ loading: false });
  },
  close: () => {
    get().cancel();
    set({ active: false });
  },
}));
