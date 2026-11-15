import type { FarmLoadStatus } from "../types/api";

// Optional NDVI can still be running when all required stages have become ready.
export function needsLoadWatch(status: FarmLoadStatus, ndviMissing: boolean): boolean {
  const active = status.stages.some((stage) => stage.status === "pending" || stage.status === "running");
  const ndviReady = status.stages.some((stage) => stage.stage === "ndvi" && stage.status === "ready");
  return active || !status.soil_final || (ndviReady && ndviMissing);
}
