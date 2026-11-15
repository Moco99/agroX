import { es, fmt, fmtDate } from "../i18n/es";
import type { TwinSimulateResponse, ZoneResult } from "../types/api";

// ─────────────────────────────────────────
// Section: Deterministic template explanation (no LLM, only engine outputs, plain es-MX)
// ─────────────────────────────────────────

export interface Explanation {
  paragraphs: string[];
  suggestion: string | null;
}

function cropName(id: string): string {
  return es.crops[id] ?? id;
}

const T = es.explainTpl;

function zoneSentence(base: ZoneResult, scen: ZoneResult | null, stressDayKs: number | null): string {
  const b = base.summary;
  const crop = cropName(base.crop_id);
  const ks = stressDayKs === null ? null : fmt(stressDayKs, 2);
  if (!scen) {
    return T.zoneBase(base.name, crop, fmt(base.area_ha, 0), T.verdict[b.stress_class], T.stressDays(b.stress_days, ks), fmt(b.min_soil_water_fraction * 100, 0));
  }
  const s = scen.summary;
  const change = s.mean_ks < b.mean_ks ? T.change.worse : s.mean_ks > b.mean_ks ? T.change.better : T.change.same;
  return (
    T.zoneScenario(base.name, crop, change, T.verdict[s.stress_class], b.stress_days, s.stress_days, fmt(b.min_soil_water_fraction * 100, 0), fmt(s.min_soil_water_fraction * 100, 0)) +
    (s.total_irrigation_mm > 0 ? T.irrigation(fmt(s.total_irrigation_mm, 0)) : ".")
  );
}

export function explain(
  baseline: TwinSimulateResponse,
  scenario: TwinSimulateResponse | null,
  selectedZoneId: string | null,
  stressDayKs: number | null = null,
): Explanation {
  const paragraphs: string[] = [];
  const zones = selectedZoneId ? baseline.zones.filter((z) => z.zone_id === selectedZoneId) : baseline.zones;
  const first = baseline.zones[0];
  if (first) {
    const rain = first.summary.total_precip_mm;
    const et0 = first.summary.total_et0_mm;
    paragraphs.push(T.period(fmtDate(baseline.start), fmtDate(baseline.end), fmt(rain, 0), fmt(et0, 0)) + (rain >= et0 ? T.rainCovers : T.rainShort));
  }
  if (scenario) {
    const e = scenario.scenario_expanded;
    const pct = Math.round((e.precip_factor - 1) * 100);
    paragraphs.push(
      T.scenario(`${pct >= 0 ? "+" : ""}${pct}`, `${e.temp_delta_c >= 0 ? "+" : ""}${fmt(e.temp_delta_c, 1)}`, es.irrigation[e.irrigation_level ?? "NONE"].toLowerCase(), es.app.exploratory),
    );
  }
  for (const z of zones) {
    const sz = scenario?.zones.find((x) => x.zone_id === z.zone_id) ?? null;
    paragraphs.push(zoneSentence(z, sz, stressDayKs));
    const stage = z.summary.stage_dates;
    if (!scenario && stage.mid_season) {
      paragraphs.push(T.stages(fmtDate(stage.planting), fmtDate(stage.mid_season), fmtDate(stage.maturity)));
    }
    const modis = z.comparison.find((c) => c.source_id === "modis_ndvi");
    if (!scenario && modis && modis.correlation !== null) {
      paragraphs.push(T.modis(fmt(modis.correlation, 2), modis.lag_days));
    }
  }
  let suggestion: string | null = null;
  const worst = (scenario ?? baseline).zones.reduce<ZoneResult | null>(
    (acc, z) => (!acc || z.summary.mean_ks < acc.summary.mean_ks ? z : acc),
    null,
  );
  if (worst && (worst.summary.stress_class === "MEDIUM" || worst.summary.stress_class === "HIGH")) {
    const stress = es.reading.stress[worst.summary.stress_class];
    suggestion =
      worst.irrigation_level === "NONE"
        ? T.tryIrrigation(worst.name, stress)
        : T.moreIrrigation(es.irrigation[worst.irrigation_level].toLowerCase(), worst.name, stress);
  } else if (scenario) {
    suggestion = T.allLow;
  }
  return { paragraphs, suggestion };
}
