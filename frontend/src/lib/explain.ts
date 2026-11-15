import { es, fmt, fmtDate } from "../i18n/es";
import type { StressClass, TwinSimulateResponse, ZoneResult } from "../types/api";

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

// One plain verdict per backend stress class; the class itself comes from the engine thresholds
const VERDICT: Record<StressClass, string> = {
  NONE: "el agua del suelo alcanzó para el cultivo",
  LOW: "hubo poca falta de agua (estrés leve)",
  MEDIUM: "faltó agua en varios momentos (estrés moderado)",
  HIGH: "faltó agua buena parte del periodo (estrés alto)",
};

function stressDaysText(days: number, stressDayKs: number | null): string {
  const unit = days === 1 ? "día" : "días";
  return stressDayKs === null
    ? `${days} ${unit} con estrés hídrico`
    : `${days} ${unit} con estrés hídrico (Ks menor a ${fmt(stressDayKs, 2)})`;
}

function zoneSentence(base: ZoneResult, scen: ZoneResult | null, stressDayKs: number | null): string {
  const b = base.summary;
  const crop = cropName(base.crop_id);
  if (!scen) {
    return (
      `${base.name} (${crop}, ${fmt(base.area_ha, 0)} ha): ${VERDICT[b.stress_class]}. ` +
      `Tuvo ${stressDaysText(b.stress_days, stressDayKs)} y, en el momento más seco, al suelo le quedó ` +
      `${fmt(b.min_soil_water_fraction * 100, 0)} % de su agua útil.`
    );
  }
  const s = scen.summary;
  const worse = s.mean_ks < b.mean_ks;
  return (
    `${base.name} (${crop}): con el escenario ${worse ? "empeora" : s.mean_ks > b.mean_ks ? "mejora" : "no cambia"} — ` +
    `${VERDICT[s.stress_class]}. Días con estrés: ${b.stress_days} → ${s.stress_days}; ` +
    `agua útil mínima en el suelo: ${fmt(b.min_soil_water_fraction * 100, 0)} % → ${fmt(s.min_soil_water_fraction * 100, 0)} %` +
    (s.total_irrigation_mm > 0 ? `; riego simulado: ${fmt(s.total_irrigation_mm, 0)} mm.` : ".")
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
    paragraphs.push(
      `Del ${fmtDate(baseline.start)} al ${fmtDate(baseline.end)} llovieron ${fmt(rain, 0)} mm y el clima ` +
        `“pidió” ${fmt(et0, 0)} mm de agua (ET0, FAO-56): ` +
        (rain >= et0 ? "la lluvia cubrió la demanda del clima en el total del periodo." : "la lluvia fue menor que la demanda del clima, así que el cultivo dependió del agua guardada en el suelo."),
    );
  }
  if (scenario) {
    const e = scenario.scenario_expanded;
    const pct = Math.round((e.precip_factor - 1) * 100);
    paragraphs.push(
      `Escenario hipotético: lluvia ${pct >= 0 ? "+" : ""}${pct} %, temperatura ${e.temp_delta_c >= 0 ? "+" : ""}${fmt(e.temp_delta_c, 1)} °C, ` +
        `riego ${es.irrigation[e.irrigation_level ?? "NONE"].toLowerCase()}. ${es.app.exploratory}.`,
    );
  }
  for (const z of zones) {
    const sz = scenario?.zones.find((x) => x.zone_id === z.zone_id) ?? null;
    paragraphs.push(zoneSentence(z, sz, stressDayKs));
    const stage = z.summary.stage_dates;
    if (!scenario && stage.mid_season) {
      paragraphs.push(
        `Etapas calculadas con el calor acumulado (grados-día): siembra ${fmtDate(stage.planting)}, floración ${fmtDate(stage.mid_season)}, ` +
          `madurez ${fmtDate(stage.maturity)}. Los parámetros del cultivo son provisionales.`,
      );
    }
    const modis = z.comparison.find((c) => c.source_id === "modis_ndvi");
    if (!scenario && modis && modis.correlation !== null) {
      paragraphs.push(
        `Contraste con el satélite MODIS: la forma del verdor observado se parece a la esperada con r = ${fmt(modis.correlation, 2)} ` +
          `(1 = idéntica)` +
          (modis.lag_days !== null ? ` y el reverdecimiento difiere ${modis.lag_days} días.` : "."),
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
        ? `${worst.name} queda con ${es.reading.stress[worst.summary.stress_class]}: prueba un nivel de riego para ver cuánto lo reduce el modelo.`
        : `Aun con riego ${es.irrigation[worst.irrigation_level].toLowerCase()}, ${worst.name} mantiene ${es.reading.stress[worst.summary.stress_class]}: compara con un nivel mayor.`;
  } else if (scenario) {
    suggestion = "Con este escenario el estrés simulado se mantiene bajo en todas las zonas.";
  }
  return { paragraphs, suggestion };
}
