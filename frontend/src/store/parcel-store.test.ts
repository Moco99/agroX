import { beforeEach, describe, expect, it } from "vitest";
import { PILOT_CENTER } from "../lib/globe-view";
import { canOpenAt } from "./open-parcel";
import { centerOf, SOURCE_KEYS, useParcelStore } from "./parcel-store";
import type { Health } from "../types/api";

function health(mode: Health["data_mode"], flag?: boolean): Health {
  return {
    status: "ok",
    version: "t",
    data_mode: mode,
    data_state: "MEASURED",
    requested_mode: mode,
    weather_coverage: { start: "2020-01-01", end: "2026-11-01" },
    derived_built_at: null,
    farms: [],
    warnings: [],
    ...(flag === undefined ? {} : { any_parcel_supported: flag }),
  };
}

describe("parcel store", () => {
  beforeEach(() => {
    useParcelStore.setState({ capability: "unknown" });
    useParcelStore.getState().setFarm("story_pilot_farm");
  });

  it("starts on the pilot and centres on it", () => {
    expect(useParcelStore.getState().farmId).toBe("story_pilot_farm");
    expect(centerOf("story_pilot_farm")).toEqual(PILOT_CENTER);
  });

  it("switches farm, resets progress and centres on the parcel", () => {
    const st = useParcelStore.getState();
    st.beginLoad();
    st.setFarm("pt_18.83_-96.78");
    const now = useParcelStore.getState();
    expect(now.farmId).toBe("pt_18.83_-96.78");
    expect(now.center).toEqual([-96.78, 18.83]);
    expect(now.phase).toBe("idle");
    expect(SOURCE_KEYS.every((k) => now.sources[k].state === "idle")).toBe(true);
  });

  it("tracks per-source progress and the final phase", () => {
    const st = useParcelStore.getState();
    st.beginLoad();
    expect(useParcelStore.getState().phase).toBe("loading");
    st.markSource("farm", "ok");
    st.markSource("ndvi", "error", "Sentinel timeout");
    st.finishLoad("ready");
    const now = useParcelStore.getState();
    expect(now.sources.farm.state).toBe("ok");
    expect(now.sources.ndvi.message).toBe("Sentinel timeout");
    expect(now.phase).toBe("ready");
  });

  it("derives capability from health", () => {
    useParcelStore.getState().setHealth(health("real"));
    expect(useParcelStore.getState().capability).toBe("unsupported");
    useParcelStore.getState().setHealth(health("live"));
    expect(useParcelStore.getState().capability).toBe("supported");
    useParcelStore.getState().setHealth(health("live", false));
    expect(useParcelStore.getState().capability).toBe("unsupported");
  });
});

describe("canOpenAt", () => {
  beforeEach(() => useParcelStore.setState({ capability: "supported" }));

  it("accepts a valid point and returns its id", () => {
    expect(canOpenAt({ lat: 18.8312, lon: -96.7799 })).toEqual({ ok: true, farmId: "pt_18.83_-96.78" });
  });

  it("explains latitude failures and unsupported backends", () => {
    expect(canOpenAt({ lat: 80, lon: 0 })).toEqual({ ok: false, reason: "latitude-north" });
    expect(canOpenAt({ lat: -70, lon: 0 })).toEqual({ ok: false, reason: "latitude-south" });
    useParcelStore.setState({ capability: "unsupported" });
    expect(canOpenAt({ lat: 10, lon: 10 })).toEqual({ ok: false, reason: "unsupported" });
  });
});
