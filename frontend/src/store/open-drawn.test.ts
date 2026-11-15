import { afterEach, describe, expect, it, vi } from "vitest";
import { es } from "../i18n/es";
import { ApiError, api } from "../services/api";
import { openDrawn } from "./open-parcel";
import { useParcelStore } from "./parcel-store";
import { useStageStore } from "./stage-store";
import { useTwinStore } from "./twin-store";

const TRIANGLE = [
  { lat: 42.03, lon: -93.63 },
  { lat: 42.03, lon: -93.62 },
  { lat: 42.04, lon: -93.62 },
];
const FARM_ID = "poly_42.0350_-93.6250_d9527f3b6042";

afterEach(() => vi.restoreAllMocks());

describe("openDrawn", () => {
  it("activates the poly_ farm and goes to the twin stage", async () => {
    vi.spyOn(api, "registerPolygonFarm").mockResolvedValue({ farm_id: FARM_ID, area_ha: 46 });
    vi.spyOn(useTwinStore.getState(), "init").mockResolvedValue();
    const goTo = vi.spyOn(useStageStore.getState(), "goTo").mockImplementation(() => {});
    expect(await openDrawn([TRIANGLE])).toBeNull();
    expect(useParcelStore.getState().farmId).toBe(FARM_ID);
    expect(goTo).toHaveBeenCalledWith("twin");
  });

  it("explains a 405 as an outdated backend", async () => {
    vi.spyOn(api, "registerPolygonFarm").mockRejectedValue(new ApiError("Method Not Allowed", 405));
    expect(await openDrawn([TRIANGLE])).toBe(es.drawParcel.outdatedBackend);
  });
});
