import { describe, expect, it } from "vitest";
import { parseCoordinates } from "./coord-parse";

describe("parseCoordinates", () => {
  it.each(["20.73, -97.89", "20.73 -97.89", "20.73,-97.89", "20,73 -97,89"])("decimal %s", (s) => {
    expect(parseCoordinates(s)).toEqual({ ok: true, lat: 20.73, lon: -97.89 });
  });

  it("parses DMS with hemispheres", () => {
    const r = parseCoordinates(`20°43'54"N 97°53'30"W`);
    expect(r.ok && r.lat).toBeCloseTo(20.731667, 5);
    expect(r.ok && r.lon).toBeCloseTo(-97.891667, 5);
  });

  it("parses Google Maps URLs", () => {
    const r = parseCoordinates("https://www.google.com/maps/@20.731,-97.891,17z");
    expect(r).toEqual({ ok: true, lat: 20.731, lon: -97.891 });
    const pin = parseCoordinates("https://www.google.com/maps/place/X/@1,2,15z/data=!3d19.43!4d-99.13");
    expect(pin).toEqual({ ok: true, lat: 19.43, lon: -99.13 });
  });

  it("validates ranges and format", () => {
    expect(parseCoordinates("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCoordinates("hola")).toEqual({ ok: false, reason: "format" });
    expect(parseCoordinates("80, -97")).toEqual({ ok: false, reason: "lat-range" });
    expect(parseCoordinates("-61, 10")).toEqual({ ok: false, reason: "lat-range" });
    expect(parseCoordinates("20, 190")).toEqual({ ok: false, reason: "lon-range" });
  });
});
