import { describe, expect, it } from "vitest";
import { stageMarks } from "./stage-marks";
import type { PhenoStage, TwinState } from "../types/api";

function run(stages: Array<[string, PhenoStage]>): TwinState[] {
  return stages.map(([date, stage]) => ({ date, stage }) as TwinState);
}

describe("stageMarks", () => {
  it("places the first day of each stage by date and skips pre-planting", () => {
    const marks = stageMarks(run([["2024-04-01", "PRE_PLANTING"], ["2024-05-01", "INITIAL"], ["2024-05-02", "INITIAL"], ["2024-07-01", "DEVELOPMENT"]]), "2024-04-01", "2024-10-31");
    expect(marks.map((m) => m.stage)).toEqual(["INITIAL", "DEVELOPMENT"]);
    expect(marks[0]?.pct).toBeCloseTo((30 / 213) * 100, 1);
    expect(marks.every((m) => m.labelled)).toBe(true);
  });
  it("hides labels that would overlap", () => {
    const marks = stageMarks(run([["2024-10-25", "INITIAL"], ["2024-10-27", "DEVELOPMENT"], ["2024-10-30", "MID_SEASON"]]), "2024-04-01", "2024-10-31");
    expect(marks.map((m) => m.labelled)).toEqual([true, false, false]);
  });
});
