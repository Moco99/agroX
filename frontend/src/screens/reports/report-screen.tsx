import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmt, fmtDate } from "../../i18n/es";
import { metricOf } from "../../lib/climate-view";
import { cropLabel } from "../../lib/farm-labels";
import { isPilotFarm } from "../../lib/parcel";
import { useModuleView } from "../../store/module-store";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import type { ClimateResponse, FarmAnalyzeResponse, TwinSimulateResponse } from "../../types/api";
import type { RotationResponse } from "../rotation/rotation-api";
import "./report.css";

// ─────────────────────────────────────────
// Section: Informes module (printable report built only from data already in app state)
// ─────────────────────────────────────────

const CLIMATE_KEYS = ["precip_total", "t_mean", "gdd_total", "et0_total", "frost_days", "hot_days"] as const;

export interface ReportProps {
  farm: FarmAnalyzeResponse | null;
  climate: ClimateResponse | null;
  twin: TwinSimulateResponse | null;
  // Which window the climate section shows; drives its caption
  climateFrom?: "clima" | "twin";
  // Zones whose crop the user declared (the pilot counts as declared)
  declaredCrops?: Record<string, string>;
  rotation: { baseline: RotationResponse; scenario: RotationResponse | null } | null;
  now?: Date;
}

function RotationList({ label, result }: { label: string; result: RotationResponse }) {
  return (
    <div>
      <h3>
        {label} <DataStateBadge state="ESTIMATED" compact />
      </h3>
      <ol>
        {result.recommendations.map((item) => (
          <li key={item.sequence.join("-")}>
            {item.cycles.map((c) => c.name).join(" → ")}: índice <strong>{fmt(item.overall_score, 1)} / 100</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReportView({ farm, climate, twin, rotation, climateFrom = "twin", declaredCrops = {}, now = new Date() }: ReportProps) {
  const f = farm?.farm;
  const pilot = f ? isPilotFarm(f.farm_id) : false;
  return (
    <article className="report">
      <header>
        <h1>
          {es.report.title}
          {f ? `: ${f.name}` : ""}
        </h1>
        <small className="muted">
          {es.report.generated}: {fmtDate(now.toISOString().slice(0, 10))}
        </small>
      </header>
      <p className="report-disclaimer" role="note">
        {es.report.disclaimer}
      </p>

      <section>
        <h2>{es.report.farm}</h2>
        {!farm || !f ? (
          <p className="muted">{es.report.noData}</p>
        ) : (
          <>
            <p>
              {es.report.area}: <strong>{fmt(f.area_ha, 1)} ha</strong> · {es.report.zones}: <strong>{f.zones.length}</strong>
            </p>
            <table>
              <thead>
                <tr>
                  <th>{es.report.zones}</th>
                  <th>{es.report.area}</th>
                  <th>{es.report.crop}</th>
                  <th>{es.report.soil}</th>
                  <th>{es.report.terrain}</th>
                </tr>
              </thead>
              <tbody>
                {f.zones.map((z) => (
                  <tr key={z.zone_id}>
                    <td>
                      {z.name} <DataStateBadge state={z.data_state} compact />
                    </td>
                    <td>{fmt(z.area_ha, 1)} ha</td>
                    <td>
                      {(() => {
                        const c = cropLabel(z.crop_id, pilot || Boolean(declaredCrops[z.zone_id]));
                        return (
                          <>
                            {c.text} <DataStateBadge state={c.state} compact />
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      {z.soil.texture ?? "—"} · {fmt(z.soil.awc_mm_per_m, 0)} mm/m <DataStateBadge state={z.soil.provenance.data_state} compact />
                      <small className="muted"> {z.soil.provenance.source}</small>
                    </td>
                    <td>
                      {fmt(z.terrain.elevation_mean_m, 0)} m · {fmt(z.terrain.slope_mean_pct, 1)} % <DataStateBadge state={z.terrain.data_state} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>{es.report.climate}</h2>
        {!climate ? (
          <p className="muted">{es.report.climateNone}</p>
        ) : (
          <>
            <small className="muted">
              {climateFrom === "clima" ? es.report.climateWindowClima : es.report.climateWindowTwin}:{" "}
              {fmtDate(climate.series.days[0]?.date)} – {fmtDate(climate.series.days.at(-1)?.date)} · {es.report.source}: {climate.series.provenance.source}
            </small>
            <ul>
              {CLIMATE_KEYS.map((k) => {
                const m = metricOf(climate.indicators, k);
                return (
                  <li key={k}>
                    {es.climateModule.labels[k]}:{" "}
                    <strong>
                      {fmt(m?.value, k.endsWith("_days") ? 0 : 1)} {m?.unit}
                    </strong>{" "}
                    <DataStateBadge state={m?.data_state ?? null} compact />
                    {m?.source && <small className="muted"> {m.source}</small>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>{es.report.ndvi}</h2>
        {!farm || !f || Object.keys(farm.latest_ndvi).length === 0 ? (
          <p className="muted">{es.report.ndviNone}</p>
        ) : (
          <>
            <ul>
              {f.zones.map((z) => (
                <li key={z.zone_id}>
                  {z.name}: <strong>{fmt(farm.latest_ndvi[z.zone_id], 2)}</strong> <DataStateBadge state="MEASURED" compact />
                </li>
              ))}
            </ul>
            <small className="muted">
              {fmtDate(farm.latest_ndvi_date)} · {es.report.source}: {farm.latest_ndvi_source ?? "—"}
            </small>
          </>
        )}
      </section>

      <section>
        <h2>{es.report.twin}</h2>
        {!twin ? (
          <p className="muted">{es.report.twinNone}</p>
        ) : (
          <>
            <p>
              {fmtDate(twin.start)} – {fmtDate(twin.end)} · <DataStateBadge state="SIMULATED" compact /> · {twin.twin_level}
            </p>
            <ul>
              <li>
                Estrés hídrico medio (Ks, ponderado por área): <strong>{fmt(twin.farm_summary.mean_ks_area_weighted, 2)}</strong> ({twin.farm_summary.stress_class})
              </li>
              <li>
                Precipitación del periodo: <strong>{fmt(twin.farm_summary.total_precip_mm, 0)} mm</strong>
              </li>
              <li>
                Riego aplicado: <strong>{fmt(twin.farm_summary.total_irrigation_mm, 0)} mm</strong>
              </li>
            </ul>
            <small className="muted">{twin.methodology}</small>
          </>
        )}
      </section>

      <section>
        <h2>{es.report.rotation}</h2>
        {!rotation ? (
          <p className="muted">{es.report.rotationNone}</p>
        ) : (
          <>
            <RotationList label="Línea base" result={rotation.baseline} />
            {rotation.scenario && <RotationList label="Escenario" result={rotation.scenario} />}
            <small className="muted">Índice comparativo, no una probabilidad. {rotation.baseline.methodology}</small>
          </>
        )}
      </section>

      <p className="report-disclaimer" role="note">
        {es.report.disclaimer}
      </p>
    </article>
  );
}

export default function ReportScreen() {
  const farmId = useParcelStore((s) => s.farmId);
  const farm = useTwinStore((s) => s.farm);
  const twinClimate = useTwinStore((s) => s.climate);
  const moduleClimate = useModuleView((s) => s.climate);
  const declaredCrops = useParcelStore((s) => s.declaration.crops);
  const baseline = useTwinStore((s) => s.baseline);
  const rotation = useModuleView((s) => s.rotation);
  // Everything shown must belong to the selected farm; stale results from another parcel are dropped
  const sameFarm = farm?.farm.farm_id === farmId;
  return (
    <div className="module-screen">
      <div className="report-actions">
        <button type="button" className="ghost-button" onClick={() => window.print()}>
          {es.report.download}
        </button>
      </div>
      <ReportView
        farm={sameFarm ? farm : null}
        climate={sameFarm ? (moduleClimate?.farmId === farmId ? moduleClimate.data : twinClimate) : null}
        climateFrom={moduleClimate?.farmId === farmId ? "clima" : "twin"}
        declaredCrops={declaredCrops}
        twin={baseline?.farm_id === farmId ? baseline : null}
        rotation={rotation?.farmId === farmId ? rotation : null}
      />
    </div>
  );
}
