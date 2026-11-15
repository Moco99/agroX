import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import type { FarmAnalyzeResponse, TwinSimulateRequest, TwinSimulateResponse } from "../types/api";
import { useParcelStore } from "./parcel-store";
import { DEFAULT_CONTROLS, useTwinStore, type RotationPreview } from "./twin-store";

const farmId = "story_pilot_farm";
const farm = { farm: { farm_id: farmId, zones: [{ zone_id: "zone_nw" }, { zone_id: "zone_se" }] } } as FarmAnalyzeResponse;
const span = { start: "2024-04-01", end: "2024-10-31" };
const preview: RotationPreview = {
  farmId, index: 0, precipPct: -20, tempDelta: 2,
  cycles: [
    { cropId: "corn", name: "Maíz", span, supported: true },
    { cropId: "soybean", name: "Soya", span: { start: "2023-04-01", end: "2023-10-31" }, supported: true },
    { cropId: "bean", name: "Frijol", span, supported: false },
  ],
};

function simulate(request: TwinSimulateRequest): TwinSimulateResponse {
  return {
    farm_id: request.farm_id,
    start: request.start,
    end: request.end,
    zones: farm.farm.zones.map(({ zone_id }) => ({
      zone_id, crop_id: request.crop_overrides?.[zone_id] ?? "corn",
      planting_date: `${request.start.slice(0, 4)}-05-15`, states: [],
    })),
  } as unknown as TwinSimulateResponse;
}

beforeEach(() => {
  useParcelStore.setState({ farmId });
  useTwinStore.setState({
    farm, health: null, baseline: simulate({ farm_id: farmId, ...span, scenario: {} }),
    scenario: null, span, plan: null, rotationPreview: null, controls: DEFAULT_CONTROLS, loading: false, simulating: false,
  });
  vi.spyOn(api, "simulate").mockImplementation(async (request) => simulate(request));
});
afterEach(() => vi.restoreAllMocks());

describe("rotation preview", () => {
  it("changes the crop and dates in every zone while keeping the climate scenario and saved declaration", async () => {
    const declaration = useParcelStore.getState().declaration;
    await useTwinStore.getState().previewRotation(preview);
    const first = useTwinStore.getState();
    expect(first.baseline?.zones.map((zone) => zone.crop_id)).toEqual(["corn", "corn"]);
    expect(first.canvasTab).toBe("twin");
    await useTwinStore.getState().previewRotation({ ...preview, index: 1 });
    const second = useTwinStore.getState();
    expect(second.scenario?.zones.map((zone) => zone.crop_id)).toEqual(["soybean", "soybean"]);
    expect(second.span).toEqual(preview.cycles[1]?.span);
    expect(vi.mocked(api.simulate).mock.calls.at(-1)?.[0]).toMatchObject({
      farm_id: farmId, start: "2023-04-01", end: "2023-10-31",
      scenario: { precip_factor: 0.8, temp_delta_c: 2 },
      crop_overrides: { zone_nw: "soybean", zone_se: "soybean" },
    });
    expect(useParcelStore.getState().declaration).toBe(declaration);
  });

  it("preserves the last valid run when a crop is unsupported or its planting date is outside the period", async () => {
    const baseline = useTwinStore.getState().baseline;
    await expect(useTwinStore.getState().previewRotation({ ...preview, index: 2 })).rejects.toThrow("catálogo");
    expect(api.simulate).not.toHaveBeenCalled();
    const tooEarly = { ...preview, cycles: [{ ...preview.cycles[0]!, span: { ...span, end: "2024-04-15" } }] };
    await expect(useTwinStore.getState().previewRotation(tooEarly)).rejects.toThrow("fecha de siembra");
    expect(useTwinStore.getState().baseline).toBe(baseline);
    expect(useTwinStore.getState().rotationPreview).toBeNull();
    expect(useTwinStore.getState().simulating).toBe(false);
  });
});

describe("historical weather as a future scenario", () => {
  it("uses the chosen reference year for the new window and later scenario edits without changing declarations", async () => {
    const declaration = useParcelStore.getState().declaration;
    const future = { start: "2026-12-01", end: "2027-02-28" };
    await useTwinStore.getState().simulateWindow(future, 2024);
    expect(vi.mocked(api.simulate).mock.calls[0]?.[0]).toMatchObject({ ...future, reference_year: 2024 });
    expect(useTwinStore.getState().span).toEqual(future);
    expect(useTwinStore.getState().referenceYear).toBe(2024);
    // A new period rewinds to its first day and plays (jsdom has no reduced-motion preference)
    expect(useTwinStore.getState().dayIndex).toBe(0);
    expect(useTwinStore.getState().playing).toBe(true);
    expect(useParcelStore.getState().declaration).toBe(declaration);
    useTwinStore.setState({ controls: { ...DEFAULT_CONTROLS, precipPct: -20 } });
    await useTwinStore.getState().runScenario();
    expect(vi.mocked(api.simulate).mock.calls.at(-1)?.[0]).toMatchObject({ ...future, reference_year: 2024, scenario: { precip_factor: 0.8 } });
  });

  it("carries the shifted historical year when previewing a later rotation cycle", async () => {
    const later = { start: "2027-04-01", end: "2027-10-31" };
    const futurePreview: RotationPreview = { ...preview, index: 0, referenceYear: 2024, referenceStartYear: 2026,
      cycles: [{ cropId: "corn", name: "Maíz", span: later, supported: true }] };
    await useTwinStore.getState().previewRotation(futurePreview);
    expect(vi.mocked(api.simulate).mock.calls[0]?.[0]).toMatchObject({ ...later, reference_year: 2025 });
    expect(useTwinStore.getState().referenceYear).toBe(2025);
  });
});
