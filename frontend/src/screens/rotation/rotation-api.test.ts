import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendRotation, startCropOptions, type RotationRequest } from "./rotation-api";

const request: RotationRequest = {
  farm_id: "story_pilot_farm", start: "2024-04-01", end: "2024-10-31", cycles: 2,
  top_k: 3, exclude_same_family: false, weights: { water: 1, soil: 1, climate: 1 },
  scenario: { temp_delta_c: 0, precip_factor: 1 },
};
const response = {
  status: "ok", methodology: "EcoCrop", data_state: "ESTIMATED", inputs: { soil_ph: null }, warnings: [],
  recommendations: [{
    sequence: ["bean", "corn"], overall_score: 75, score_type: "comparative_index", field_validated: false,
    warnings: [], indicators: { water: 80, soil: null, climate: 70 }, weights: { water: 0.5, soil: 0, climate: 0.5 },
    cycles: [{ cycle: 1, crop_id: "bean", name: "Frijol", family: "Fabaceae", rainfall_fit: 80,
      temperature_fit: 70, ph_fit: null, data_state: "complete", warnings: [] }],
  }],
};
afterEach(() => vi.unstubAllGlobals());
describe("rotation API", () => {
  it("accepts a valid ranking without an invented pH score", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })));
    const result = await recommendRotation(request, new AbortController().signal);
    expect(result.recommendations[0]?.indicators.soil).toBeNull();
    expect(result.recommendations[0]?.cycles[0]?.ph_fit).toBeNull();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string)).toEqual(request);
  });
  it("reports backend validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Periodo sin datos" }), { status: 422 })));
    await expect(recommendRotation(request, new AbortController().signal)).rejects.toThrow("Periodo sin datos");
  });
  it("names the offending field of a 422 validation error", async () => {
    const detail = [{ type: "extra_forbidden", loc: ["body", "weights", "agua"], msg: "Extra inputs are not permitted" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 422 })));
    await expect(recommendRotation(request, new AbortController().signal)).rejects.toThrow("Dato no reconocido (campo: weights.agua)");
  });
  it("never shows raw English validation messages", async () => {
    const detail = [{ type: "int_parsing", loc: ["body", "cycles"], msg: "Input should be a valid integer" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 422 })));
    await expect(recommendRotation(request, new AbortController().signal)).rejects.toThrow("El dato no es válido (campo: cycles)");
  });
  it("offers only twin-simulatable starting crops when the filter is on", () => {
    const all: [string, string][] = [["corn", "Maíz"], ["sorghum", "Sorgo"]];
    expect(startCropOptions(all, ["corn"], true)).toEqual([["corn", "Maíz"]]);
    expect(startCropOptions(all, ["corn"], false)).toEqual(all);
    expect(startCropOptions(all, null, true)).toEqual(all);
  });
  it("rejects malformed ranking data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ recommendations: [{ overall_score: "alto" }] }), { status: 200 })));
    await expect(recommendRotation(request, new AbortController().signal)).rejects.toThrow("formato inesperado");
  });
});
