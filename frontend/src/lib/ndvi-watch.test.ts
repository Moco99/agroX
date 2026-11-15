import { describe, expect, it } from "vitest";
import { needsLoadWatch } from "./ndvi-watch";
import type { FarmLoadStatus } from "../types/api";

function status(ndvi: string): FarmLoadStatus {
  return { state: "ready", soil_final: true, stages: [{ stage: "ndvi", status: ndvi }] } as FarmLoadStatus;
}

describe("NDVI background polling", () => {
  it("continues after required sources finish while optional NDVI is still running", () => {
    expect(needsLoadWatch(status("running"), true)).toBe(true);
  });
  it("retries loading the series after the backend is ready until it reaches the frontend", () => {
    expect(needsLoadWatch(status("ready"), true)).toBe(true);
    expect(needsLoadWatch(status("ready"), false)).toBe(false);
  });
  it("stops when NDVI has failed so the retry action can be offered", () => {
    expect(needsLoadWatch(status("failed"), true)).toBe(false);
  });
});
