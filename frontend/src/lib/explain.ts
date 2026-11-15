import { es, fmt, fmtDate } from "../i18n/es";
import type { TwinSimulateResponse, ZoneResult } from "../types/api";

// ─────────────────────────────────────────
// Section: Deterministic template explanation (no LLM, only engine outputs)
// ─────────────────────────────────────────

export interface Explanation {
  paragraphs: string[];
  suggestion: string | null;
}

function cropName(id: string): string {
  return es.crops[id] ?? id;
}

function zoneSentence(base: ZoneResult, scen: ZoneResult | null): string {
  const b = base.summary;
  const crop = cropName(base.crop_id);
  if (!scen) {
    return (
      `${base.name} (${crop}, ${fmt(base.area_ha, 0)} ha): Ks medio ${fmt(b.mean_ks, 2)} ` +
      `(${es.stressClass[b.stress_class].toLowerCase()}), ${b.stress_days} días con Ks < 0.8 y agua mínima ` +
      `en la zona radicular de ${fmt(b.min_soil_water_fraction * 100, 0)} % de TAW.`
    );
  }
  const s = scen.summary;
  return (
    `${base.name} (${crop}): Ks medio ${fmt(b.mean_ks, 2)} → ${fmt(s.mean_ks, 2)} ` +
    `(${es.stressClass[s.stress_class].toLowerCase()}); días con estrés ${b.stress_days} → ${s.stress_days}; ` +
    `agua mínima ${fmt(b.min_soil_water_fraction * 100, 0)} % → ${fmt(s.min_soil_water_fraction * 100, 0)} % de TAW` +
    (s.total_irrigation_mm > 0 ? `; riego simulado ${fmt(s.total_irrigation_mm, 0)} mm.` : ".")
  );
}

export function explain(
  baseline: TwinSimulateResponse,
  scenario: TwinSimulateResponse | null,
  selectedZoneId: string | null,
): Explanation {
  const paragraphs: string[] = [];
  const zones = selectedZoneId ? baseline.zones.filter((z) => z.zone_id === selectedZoneId) : baseline.zones;
  const first = baseline.zones[0];
  if (first) {
    paragraphs.push(
      `Periodo ${fmtDate(baseline.start)} – ${fmtDate(baseline.end)}: lluvia observada ${fmt(first.summary.total_precip_mm, 0)} mm ` +
        `y ET0 ${fmt(first.summary.total_et0_mm, 0)} mm (FAO-56 Penman-Monteith).`,
    );
  }
  if (scenario) {
    const e = scenario.scenario_expanded;
    const pct = Math.round((e.precip_factor - 1) * 100);
    paragraphs.push(
      `Escenario: precipitación ${pct >= 0 ? "+" : ""}${pct} %, temperatura ${e.temp_delta_c >= 0 ? "+" : ""}${fmt(e.temp_delta_c, 1)} °C, ` +
        `riego ${es.irrigation[e.irrigation_level ?? "NONE"].toLowerCase()}. ${es.app.exploratory}.`,
    );
  }
  for (const z of zones) {
    const sz = scenario?.zones.find((x) => x.zone_id === z.zone_id) ?? null;
    paragraphs.push(zoneSentence(z, sz));
    const stage = z.summary.stage_dates;
    if (!scenario && stage.mid_season) {
      paragraphs.push(
        `Etapas simuladas por grados-día: siembra ${fmtDate(stage.planting)}, media temporada ${fmtDate(stage.mid_season)}, ` +
          `madurez ${fmtDate(stage.maturity)} (parámetros provisionales).`,
      );
    }
    const modis = z.comparison.find((c) => c.source_id === "modis_ndvi");
    if (!scenario && modis && modis.correlation !== null) {
      paragraphs.push(
        `Contraste con MODIS: forma del NDVI observado vs. dosel esperado r = ${fmt(modis.correlation, 2)}` +
          (modis.lag_days !== null ? `, desfase de reverdecimiento ${modis.lag_days} días.` : "."),
      );
    }
  }
  let suggestion: string | null = null;
  const worst = (scenario ?? baseline).zones.reduce<ZoneResult | null>(
    (acc, z) => (!acc || z.summary.mean_ks < acc.summary.mean_ks ? z : acc),
    null,
  );
  if (worst && (worst.summary.stress_class === "MEDIUM" || worst.summary.stress_class === "HIGH")) {
    suggestion =
      worst.irrigation_level === "NONE"
        ? `${worst.name} queda con estrés ${es.stressClass[worst.summary.stress_class].toLowerCase()}: prueba un nivel de riego para ver cuánto lo reduce el modelo.`
        : `Aun con riego ${es.irrigation[worst.irrigation_level].toLowerCase()}, ${worst.name} mantiene estrés ${es.stressClass[worst.summary.stress_class].toLowerCase()}: compara con un nivel mayor.`;
  } else if (scenario) {
    suggestion = "El estrés simulado se mantiene bajo en todas las zonas con este escenario.";
  }
  return { paragraphs, suggestion };
}
