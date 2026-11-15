import { create } from "zustand";
import { areaHa } from "../lib/draw";
import { PILOT_CENTER } from "../lib/globe-view";
import { parseParcelId, PILOT_FARM_ID } from "../lib/parcel";
import { loadHistory, patchParcel, saveHistory, upsertParcel, type ParcelRecord } from "../lib/parcel-history";
import type { LatLon } from "../types/parcel";
import { useParcelStore } from "./parcel-store";
import { useTwinStore } from "./twin-store";

// ─────────────────────────────────────────
// Section: Parcel history store (persisted list of parcels the user opened or drew)
// ─────────────────────────────────────────

interface HistoryStore {
  items: ParcelRecord[];
  // Called whenever a parcel becomes active; polygons only for drawn parcels
  record: (farmId: string, extra?: { polygons?: LatLon[][]; areaHa?: number }) => void;
  rename: (farmId: string, name: string) => void;
  remove: (farmId: string) => void;
}

function centroidOf(farmId: string): [number, number] | null {
  if (farmId === PILOT_FARM_ID) return [PILOT_CENTER[1], PILOT_CENTER[0]];
  const p = parseParcelId(farmId);
  return p ? [p.lat, p.lon] : null;
}

// The pilot farm is always listed, even before it was ever opened
function withPilot(items: ParcelRecord[]): ParcelRecord[] {
  if (items.some((p) => p.farmId === PILOT_FARM_ID)) return items;
  return [
    ...items,
    { farmId: PILOT_FARM_ID, customName: null, createdAt: 0, openedAt: 0, areaHa: null, zoneCount: null, centroid: centroidOf(PILOT_FARM_ID), polygons: null },
  ];
}

export const useHistoryStore = create<HistoryStore>((set, get) => {
  const commit = (items: ParcelRecord[]) => {
    saveHistory(items);
    set({ items });
  };
  return {
    items: withPilot(loadHistory()),
    record: (farmId, extra) => {
      const polygons = extra?.polygons;
      commit(
        upsertParcel(get().items, {
          farmId,
          centroid: centroidOf(farmId),
          polygons,
          zoneCount: polygons?.length,
          areaHa: extra?.areaHa ?? (polygons ? polygons.reduce((s, p) => s + areaHa(p), 0) : undefined),
        }),
      );
    },
    rename: (farmId, name) => commit(patchParcel(get().items, farmId, { customName: name.trim() || null })),
    remove: (farmId) => commit(get().items.filter((p) => p.farmId !== farmId)),
  };
});

// Once the farm payload arrives, its real area and zone count replace the estimates kept in the history
useTwinStore.subscribe((s, prev) => {
  const farm = s.farm?.farm;
  if (!farm || farm === prev.farm?.farm) return;
  const farmId = useParcelStore.getState().farmId;
  const { items } = useHistoryStore.getState();
  if (!items.some((p) => p.farmId === farmId)) return;
  const next = patchParcel(items, farmId, { areaHa: farm.area_ha, zoneCount: farm.zones.length });
  saveHistory(next);
  useHistoryStore.setState({ items: next });
});
