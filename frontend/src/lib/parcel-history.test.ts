import { describe, expect, it } from "vitest";
import { displayName, loadHistory, MAX_PARCELS, patchParcel, saveHistory, upsertParcel } from "./parcel-history";

function memory(initial?: string) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_k: string, v: string) => void (value = v) };
}

describe("parcel history", () => {
  it("upserts most-recent-first, keeping creation time, name and polygons", () => {
    let items = upsertParcel([], { farmId: "a", customName: "Juan", polygons: [[{ lat: 1, lon: 2 }]] }, 10);
    items = upsertParcel(items, { farmId: "b" }, 20);
    items = upsertParcel(items, { farmId: "a", areaHa: 5 }, 30);
    expect(items.map((p) => p.farmId)).toEqual(["a", "b"]);
    expect(items[0]).toMatchObject({ createdAt: 10, openedAt: 30, customName: "Juan", areaHa: 5 });
    expect(items[0]!.polygons).not.toBeNull();
  });

  it("caps the list and patches without reordering", () => {
    let items: ReturnType<typeof upsertParcel> = [];
    for (let i = 0; i < MAX_PARCELS + 5; i++) items = upsertParcel(items, { farmId: `p${i}` }, i);
    expect(items).toHaveLength(MAX_PARCELS);
    expect(patchParcel(items, "p10", { zoneCount: 3 }).find((p) => p.farmId === "p10")?.zoneCount).toBe(3);
  });

  it("round-trips through storage and survives corrupt or blocked storage", () => {
    const store = memory();
    saveHistory(upsertParcel([], { farmId: "a" }, 1), store);
    expect(loadHistory(store)).toHaveLength(1);
    expect(loadHistory(memory("{oops"))).toEqual([]);
    expect(loadHistory(null)).toEqual([]);
  });

  it("names parcels", () => {
    expect(displayName({ farmId: "story_pilot_farm", customName: null, centroid: null })).toContain("Iowa");
    expect(displayName({ farmId: "x", customName: " Juan ", centroid: null })).toBe("Juan");
    expect(displayName({ farmId: "x", customName: null, centroid: [20.7312, -97.8917] })).toBe("Parcela 20.731, -97.892");
  });
});
