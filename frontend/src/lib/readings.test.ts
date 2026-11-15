import { describe, expect, it } from "vitest";
import {
  anomalyReading,
  deltaReading,
  fitReading,
  ndviReading,
  scoreReading,
  soilWaterReading,
  spiReading,
  stressReading,
} from "./readings";

describe("readings", () => {
  it("calls soil water enough while depletion stays within RAW (fraction >= 1 - p)", () => {
    expect(soilWaterReading(0.62, 0.5, "NONE")).toEqual({ tone: "good", label: "suficiente" });
    expect(soilWaterReading(0.5, 0.5, "NONE").tone).toBe("good");
    expect(soilWaterReading(0.3, 0.5, "MEDIUM")).toEqual({ tone: "warn", label: "limitada" });
    expect(soilWaterReading(0.05, 0.5, "HIGH")).toEqual({ tone: "bad", label: "insuficiente" });
  });

  it("does not judge soil water without the crop's p", () => {
    expect(soilWaterReading(0.2, null, "HIGH").tone).toBe("neutral");
  });

  it("maps backend stress classes to verdict words", () => {
    expect(stressReading("NONE")).toEqual({ tone: "good", label: "sin estrés" });
    expect(stressReading("LOW").tone).toBe("warn");
    expect(stressReading("HIGH")).toEqual({ tone: "bad", label: "estrés alto" });
  });

  it("reads NDVI with the colour classes and keeps bare soil neutral", () => {
    expect(ndviReading(null).label).toBe("agua, nube o sin dato");
    expect(ndviReading(-0.1).tone).toBe("neutral");
    expect(ndviReading(0.1)).toEqual({ tone: "neutral", label: "suelo desnudo o casi sin vegetación" });
    expect(ndviReading(0.3).tone).toBe("warn");
    expect(ndviReading(0.7).tone).toBe("good");
    expect(ndviReading(0.9).label).toBe("vegetación muy densa");
  });

  it("reports only the direction of the precipitation anomaly", () => {
    expect(anomalyReading(12).label).toBe("llovió más que lo usual");
    expect(anomalyReading(-12).label).toBe("llovió menos que lo usual");
    expect(anomalyReading(null).label).toBe("sin años de referencia");
    expect(anomalyReading(-40).tone).toBe("neutral");
  });

  it("uses McKee SPI classes for the verdict", () => {
    expect(spiReading(0.3)).toEqual({ tone: "good", label: "cercano a lo normal" });
    expect(spiReading(-1.2)).toEqual({ tone: "warn", label: "moderadamente seco" });
    expect(spiReading(-2.4).tone).toBe("bad");
    expect(spiReading(1.7).tone).toBe("bad");
    expect(spiReading(null).tone).toBe("neutral");
  });

  it("reads the comparative score relative to the best option only", () => {
    expect(scoreReading(80, [80, 70, 60])).toEqual({ tone: "good", label: "la más alta de las opciones comparadas" });
    expect(scoreReading(80, [80, 80])).toEqual({ tone: "good", label: "empatada con la más alta" });
    expect(scoreReading(70, [80, 70]).label).toBe("10.0 puntos debajo de la mejor opción");
  });

  it("follows the EcoCrop trapezoid for each fit", () => {
    expect(fitReading(100).label).toBe("dentro del rango óptimo");
    expect(fitReading(0).tone).toBe("bad");
    expect(fitReading(55).tone).toBe("warn");
    expect(fitReading(null).label).toBe("sin dato (no cuenta en el índice)");
  });

  it("says whether a scenario delta is better or worse", () => {
    expect(deltaReading(-5, true)).toEqual({ tone: "bad", label: "peor que la línea base" });
    expect(deltaReading(2, false).tone).toBe("bad");
    expect(deltaReading(0.1, true).label).toBe("mejor que la línea base");
    expect(deltaReading(0, true).tone).toBe("neutral");
  });
});
