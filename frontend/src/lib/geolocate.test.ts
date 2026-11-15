import { afterEach, describe, expect, it, vi } from "vitest";
import { locateMe } from "./geolocate";

function mockGeo(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: impl } });
}

afterEach(() => vi.unstubAllGlobals());

describe("locateMe", () => {
  it("resolves the position", async () => {
    mockGeo((ok) => ok({ coords: { latitude: 19.43, longitude: -99.13 } } as GeolocationPosition));
    expect(await locateMe()).toEqual({ lat: 19.43, lon: -99.13 });
  });

  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
  ])("maps error code %i to %s", async (code, expected) => {
    mockGeo((_ok, fail) => fail({ code } as GeolocationPositionError));
    await expect(locateMe()).rejects.toBe(expected);
  });

  it("rejects when geolocation is missing", async () => {
    vi.stubGlobal("navigator", {});
    await expect(locateMe()).rejects.toBe("unsupported");
  });
});
