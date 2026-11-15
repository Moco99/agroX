import { describe, expect, it } from "vitest";
import { addVertex, areaHa, canConfirm, drawFeatures, EMPTY_DRAW, finishPolygon, isSimplePolygon, undo } from "./draw";

const sq = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.009 },
  { lat: 0.009, lon: 0.009 },
  { lat: 0.009, lon: 0 },
];

const drawAll = (pts: typeof sq) => pts.reduce((s, p) => addVertex(s, p), EMPTY_DRAW);

describe("draw logic", () => {
  it("adds vertices and closes by clicking near the first one", () => {
    const s = addVertex(drawAll(sq), { lat: 0, lon: 0 }, true);
    expect(s.polygons).toHaveLength(1);
    expect(s.current).toHaveLength(0);
    expect(canConfirm(s)).toBe(true);
  });

  it("does not finish with fewer than 3 vertices or a self-crossing polygon", () => {
    expect(finishPolygon(drawAll(sq.slice(0, 2))).polygons).toHaveLength(0);
    const bowtie = [sq[0]!, sq[2]!, sq[1]!, sq[3]!];
    expect(isSimplePolygon(bowtie)).toBe(false);
    expect(finishPolygon(drawAll(bowtie)).polygons).toHaveLength(0);
  });

  it("undoes the last vertex, then reopens the last polygon", () => {
    const one = finishPolygon(drawAll(sq));
    const reopened = undo(one);
    expect(reopened.polygons).toHaveLength(0);
    expect(reopened.current).toHaveLength(3);
    expect(undo(reopened).current).toHaveLength(2);
    expect(undo(EMPTY_DRAW)).toBe(EMPTY_DRAW);
  });

  it("supports several polygons and blocks confirm while one is open", () => {
    let s = finishPolygon(drawAll(sq));
    s = addVertex(s, { lat: 1, lon: 1 });
    expect(canConfirm(s)).toBe(false);
    s = finishPolygon(addVertex(addVertex(s, { lat: 1, lon: 1.01 }), { lat: 1.01, lon: 1 }));
    expect(s.polygons).toHaveLength(2);
    expect(drawFeatures(s).features.filter((f) => f.properties.kind === "polygon")).toHaveLength(2);
  });

  it("computes an approximate area", () => {
    expect(areaHa(sq)).toBeGreaterThan(99);
    expect(areaHa(sq)).toBeLessThan(101);
  });
});
