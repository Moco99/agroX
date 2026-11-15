import { describe, expect, it } from "vitest";
import {
  checkParcelLat,
  isValidFarmId,
  loadDeclaration,
  parcelIdFromPoint,
  parseDeclaration,
  parseParcelId,
  readFarmDeepLink,
  saveDeclaration,
  seasonWindow,
  supportsAnyParcel,
  suggestPlantingDate,
  wrapLon,
} from "./parcel";

// ─────────────────────────────────────────
// Section: Parcel ids
// ─────────────────────────────────────────

describe("parcelIdFromPoint", () => {
  it("rounds to two decimals like the data guide", () => {
    expect(parcelIdFromPoint({ lat: 18.8312, lon: -96.7799 })).toBe("pt_18.83_-96.78");
    expect(parcelIdFromPoint({ lat: 30.8, lon: 75.55 })).toBe("pt_30.8_75.55");
  });

  it("wraps longitudes past the antimeridian and avoids -0", () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(parcelIdFromPoint({ lat: -0.001, lon: 190 })).toBe("pt_0_-170");
  });

  it("rejects latitudes outside -60..75 and non-finite input", () => {
    expect(parcelIdFromPoint({ lat: 80, lon: 0 })).toBeNull();
    expect(parcelIdFromPoint({ lat: -61, lon: 0 })).toBeNull();
    expect(parcelIdFromPoint({ lat: Number.NaN, lon: 0 })).toBeNull();
    expect(parcelIdFromPoint({ lat: -60, lon: 0 })).toBe("pt_-60_0");
    expect(parcelIdFromPoint({ lat: 75, lon: 0 })).toBe("pt_75_0");
  });

  it("explains which side of the valid band a latitude falls on", () => {
    expect(checkParcelLat(80)).toEqual({ ok: false, reason: "north" });
    expect(checkParcelLat(-70)).toEqual({ ok: false, reason: "south" });
    expect(checkParcelLat(10)).toEqual({ ok: true });
  });
});

describe("parseParcelId / deep link", () => {
  it("round-trips ids and rejects junk", () => {
    expect(parseParcelId("pt_-33.9_-60.6")).toEqual({ lat: -33.9, lon: -60.6 });
    expect(parseParcelId("pt_80_0")).toBeNull();
    expect(parseParcelId("pt_a_b")).toBeNull();
    expect(parseParcelId("../etc")).toBeNull();
  });

  it("accepts the pilot and well-formed ids from ?farm=", () => {
    expect(isValidFarmId("story_pilot_farm")).toBe(true);
    expect(readFarmDeepLink("?farm=pt_18.83_-96.78&stage=map")).toBe("pt_18.83_-96.78");
    expect(readFarmDeepLink("?farm=evil")).toBeNull();
    expect(readFarmDeepLink("")).toBeNull();
    expect(readFarmDeepLink(null)).toBeNull();
  });
});

// ─────────────────────────────────────────
// Section: Declaration persistence
// ─────────────────────────────────────────

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("declaration persistence", () => {
  it("stores per farm and reads back", () => {
    const st = fakeStorage();
    saveDeclaration("pt_1_1", { crops: { z1: "corn" }, planting: { corn: "2026-05-01" } }, st);
    expect(loadDeclaration("pt_1_1", st).crops.z1).toBe("corn");
    expect(loadDeclaration("pt_2_2", st).crops).toEqual({});
  });

  it("removes the entry when the declaration is emptied", () => {
    const st = fakeStorage();
    saveDeclaration("pt_1_1", { crops: { z1: "corn" }, planting: {} }, st);
    saveDeclaration("pt_1_1", { crops: {}, planting: {} }, st);
    expect(st.data.size).toBe(0);
  });

  it("survives corrupt data and throwing storage", () => {
    expect(parseDeclaration("{nope")).toEqual({ crops: {}, planting: {} });
    expect(parseDeclaration('{"crops":{"z":1},"planting":{}}')).toEqual({ crops: {}, planting: {} });
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(loadDeclaration("x", throwing).crops).toEqual({});
    expect(() => saveDeclaration("x", { crops: { a: "b" }, planting: {} }, throwing)).not.toThrow();
  });
});

// ─────────────────────────────────────────
// Section: Planting suggestion, window and capability
// ─────────────────────────────────────────

describe("planting helpers", () => {
  const crop = { planting_window: { start_mmdd: "05-01", end_mmdd: "05-20" } };
  it("shifts the catalog window six months south of the equator", () => {
    expect(suggestPlantingDate(crop, 40, 2026)).toBe("2026-05-01");
    expect(suggestPlantingDate(crop, -34, 2026)).toBe("2026-11-01");
  });

  it("builds a window around planting and clamps it to the weather coverage", () => {
    expect(seasonWindow("2026-05-01", 130, "2026-12-31")).toEqual({ start: "2026-04-01", end: "2026-09-28" });
    expect(seasonWindow("2026-05-01", 130, "2026-08-01").end).toBe("2026-08-01");
  });

  it("detects any-parcel support from health", () => {
    expect(supportsAnyParcel(null)).toBeNull();
    expect(supportsAnyParcel({ data_mode: "real" })).toBe(false);
    expect(supportsAnyParcel({ data_mode: "live" })).toBe(true);
    expect(supportsAnyParcel({ data_mode: "live", any_parcel_supported: false })).toBe(false);
    expect(supportsAnyParcel({ data_mode: "real", any_parcel_supported: true })).toBe(false);
  });
});
