import { es } from "../i18n/es";
import { NDVI_RAMP } from "../styles/tokens";
import type { StressClass } from "../types/api";

// ─────────────────────────────────────────
// Section: Plain-language readings (pure)
// ─────────────────────────────────────────

// A reading turns a backend number into a good/warn/bad/neutral verdict with words. It never invents a
// scientific threshold: every cut-off used here is either a model quantity served by the backend
// (p, Ks classes), a published convention (SPI classes, McKee et al. 1993), a model definition (EcoCrop
// trapezoid: 100 inside the optimum, 0 outside the tolerated range) or the visual NDVI colour classes of
// the design tokens (always neutral and labelled as such in the UI).

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface Reading {
  tone: Tone;
  label: string;
}

// ─────────────────────────────────────────
// Section: Twin (soil water and stress)
// ─────────────────────────────────────────

export function stressReading(cls: StressClass): Reading {
  const tone: Tone = cls === "NONE" ? "good" : cls === "HIGH" ? "bad" : "warn";
  return { tone, label: es.reading.stress[cls] };
}

// Soil water is "enough" while depletion stays within RAW, i.e. the remaining fraction is >= 1 - p (FAO-56).
// Below that the severity follows the stress class of the same day, so both tiles never disagree.
export function soilWaterReading(fraction: number, pFraction: number | null, cls: StressClass): Reading {
  if (pFraction === null || !Number.isFinite(pFraction)) return { tone: "neutral", label: es.reading.soilWater.unknown };
  if (fraction >= 1 - pFraction) return { tone: "good", label: es.reading.soilWater.good };
  if (cls === "HIGH") return { tone: "bad", label: es.reading.soilWater.bad };
  return { tone: "warn", label: es.reading.soilWater.warn };
}

// ─────────────────────────────────────────
// Section: NDVI (visual classes of the canonical ramp, not agronomic thresholds)
// ─────────────────────────────────────────

const NDVI_STOPS = NDVI_RAMP.map((s) => s.value);

export function ndviReading(value: number | null | undefined): Reading {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return { tone: "neutral", label: es.reading.ndvi.nodata };
  }
  const [bare = 0, low = 0, mid = 0, high = 0] = NDVI_STOPS;
  // Always neutral: the ramp stops are colour classes, not agronomic thresholds. A low NDVI is expected
  // before planting or after harvest, so the words describe the canopy without judging it.
  const label =
    value <= bare
      ? es.reading.ndvi.bare
      : value < low
        ? es.reading.ndvi.low
        : value < mid
          ? es.reading.ndvi.medium
          : value < high
            ? es.reading.ndvi.high
            : es.reading.ndvi.veryHigh;
  return { tone: "neutral", label };
}

// ─────────────────────────────────────────
// Section: Climate (precipitation anomaly and SPI)
// ─────────────────────────────────────────

// Direction only: without a published band, no "normal" range is claimed for the raw anomaly
export function anomalyReading(pct: number | null): Reading {
  if (pct === null || !Number.isFinite(pct)) return { tone: "neutral", label: es.reading.anomaly.none };
  if (pct === 0) return { tone: "neutral", label: es.reading.anomaly.same };
  return { tone: "neutral", label: pct > 0 ? es.reading.anomaly.more : es.reading.anomaly.less };
}

// SPI classes follow McKee et al. (1993); the label is descriptive, not a forecast
export function spiLabel(spi: number): string {
  const l = es.reading.spi;
  if (spi >= 2) return l.extremelyWet;
  if (spi >= 1.5) return l.veryWet;
  if (spi >= 1) return l.moderatelyWet;
  if (spi > -1) return l.normal;
  if (spi > -1.5) return l.moderatelyDry;
  if (spi > -2) return l.veryDry;
  return l.extremelyDry;
}

// Tones are a documented product decision (ui-spec): dry periods are watched (moderate) or flagged
// (very/extreme dry); very wet periods are only "watch" (possible excess water); moderate wetness is neutral
export function spiReading(spi: number | null): Reading {
  if (spi === null || !Number.isFinite(spi)) return { tone: "neutral", label: es.reading.spi.none };
  const label = spiLabel(spi);
  if (spi > -1 && spi < 1) return { tone: "good", label };
  if (spi <= -1.5) return { tone: "bad", label };
  if (spi < 0 || spi >= 1.5) return { tone: "warn", label };
  return { tone: "neutral", label };
}

// ─────────────────────────────────────────
// Section: Rotation (comparative index and EcoCrop fits)
// ─────────────────────────────────────────

// Relative to the best option of the same comparison: the index has no absolute "good" level
export function scoreReading(score: number, all: number[]): Reading {
  const best = Math.max(...all.filter((v) => Number.isFinite(v)), score);
  const ties = all.filter((v) => v === best).length;
  if (score === best) return { tone: "good", label: ties > 1 ? es.reading.score.tie : es.reading.score.best };
  const diff = best - score;
  return { tone: "neutral", label: es.reading.score.below(diff.toFixed(1)) };
}

// EcoCrop trapezoid: 100 inside the optimal range, 0 outside the tolerated range, linear in between
export function fitReading(value: number | null): Reading {
  if (value === null || !Number.isFinite(value)) return { tone: "neutral", label: es.reading.fit.none };
  if (value >= 100) return { tone: "good", label: es.reading.fit.optimal };
  if (value <= 0) return { tone: "bad", label: es.reading.fit.outside };
  return { tone: "warn", label: es.reading.fit.partial };
}

// ─────────────────────────────────────────
// Section: Scenario deltas
// ─────────────────────────────────────────

export function deltaReading(delta: number, goodWhenUp: boolean): Reading {
  if (Math.abs(delta) < 1e-6) return { tone: "neutral", label: es.reading.delta.same };
  const better = delta > 0 === goodWhenUp;
  return { tone: better ? "good" : "bad", label: better ? es.reading.delta.better : es.reading.delta.worse };
}
