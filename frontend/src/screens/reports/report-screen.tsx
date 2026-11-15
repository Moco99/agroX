import { DataStateBadge } from "../../components/data-state-badge";
import { ReadingChip } from "../../components/explain/reading-chip";
import { es, fmt, fmtDate, fmtDateTime } from "../../i18n/es";
import { metricOf, unitSymbol } from "../../lib/climate-view";
import { cropLabel } from "../../lib/farm-labels";
import { isPilotFarm } from "../../lib/parcel";
import { scenarioLabel } from "../../lib/climate-projection";
import { ndviReading, scoreReading, stressReading } from "../../lib/readings";
import { useModuleView } from "../../store/module-store";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import type { ClimateResponse, FarmAnalyzeResponse, TwinSimulateResponse } from "../../types/api";
import type { RotationResponse } from "../rotation/rotation-api";
import { SeasonOutcomeList } from "../digital-twin/season-outcome";
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
  // Historical reference year of the twin run (null = observed weather of the period)
  referenceYear?: number | null;
  now?: Date;
}

function RotationList({ label, result }: { label: string; result: RotationResponse }) {
  const scores = result.recommendations.map((r) => r.overall_score);
  return (
    <div>
      <h3>
        {label} <DataStateBadge state="ESTIMATED" compact />
      </h3>
      <ol>
        {result.recommendations.map((item) => (
          <li key={item.sequence.join("-")}>
            {item.cycles.map((c) => c.name).join(" → ")}: {es.reportCopy.index} <strong>{fmt(item.overall_score, 1)} / 100</strong>{" "}
            <ReadingChip reading={scoreReading(item.overall_score, scores)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReportView({ farm, climate, twin, rotation, climateFrom = "twin", declaredCrops = {}, referenceYear = null, now = new Date() }: ReportProps) {
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

      <section className="report-howto" data-testid="report-howto">
        <h2>{es.reportCopy.howToRead}</h2>
        <p>{es.modelNote.body}</p>
        <p>{es.modelNote.score}</p>
        <ul>
          {(["MEASURED", "DECLARED", "ESTIMATED", "SIMULATED", "SYNTHETIC"] as const).map((st) => (
            <li key={st}>
              <DataStateBadge state={st} compact /> {es.dataStateHelp[st]}
            </li>
          ))}
        </ul>
      </section>

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
                      {fmt(m?.value, k.endsWith("_days") ? 0 : 1)} {unitSymbol(m?.unit)}
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
                  {z.name}: <strong>{fmt(farm.latest_ndvi[z.zone_id], 2)}</strong>{" "}
                  <ReadingChip reading={ndviReading(farm.latest_ndvi[z.zone_id])} /> <DataStateBadge state="MEASURED" compact />
                </li>
              ))}
            </ul>
            <small className="muted">
              {es.report.ndviIndependent(fmtDate(farm.latest_ndvi_date))} {es.report.source}: {farm.latest_ndvi_source ?? "—"} · {es.reading.ndvi.note}
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
              {es.report.twinPeriod}: <strong>{fmtDate(twin.start)} – {fmtDate(twin.end)}</strong> · <DataStateBadge state="SIMULATED" compact /> ·{" "}
              {es.twinLevelText[twin.twin_level]}
            </p>
            <p className="muted" data-testid="report-twin-meta">
              {twin.climate_projection
                ? es.report.twinProjection(scenarioLabel(twin.climate_projection.scenario), twin.climate_projection.models_used.join(", "))
                : referenceYear !== null ? es.report.twinReference(referenceYear) : es.report.twinObserved}
              {twin.computed_at && ` · ${es.report.twinComputed} ${fmtDateTime(twin.computed_at)}`}
            </p>
            <ul>
              <li>
                {es.reportCopy.stressLine}: <strong>{fmt(twin.farm_summary.mean_ks_area_weighted, 2)}</strong>{" "}
                <ReadingChip reading={stressReading(twin.farm_summary.stress_class)} /> <small className="muted">({es.units.ks})</small>
              </li>
              <li>
                {es.reportCopy.precipLine}: <strong>{fmt(twin.farm_summary.total_precip_mm, 0)} mm</strong>
              </li>
              <li>
                {es.reportCopy.irrigationLine}: <strong>{fmt(twin.farm_summary.total_irrigation_mm, 0)} mm</strong>
              </li>
            </ul>
            <h3>{es.seasonOutcome.title}</h3>
            <SeasonOutcomeList run={twin} />
            <br />
            <small className="muted">{es.methodology[twin.methodology] ?? twin.methodology}</small>
          </>
        )}
      </section>

      <section>
        <h2>{es.report.rotation}</h2>
        {!rotation ? (
          <p className="muted">{es.report.rotationNone}</p>
        ) : (
          <>
            <RotationList label={es.reportCopy.baseline} result={rotation.baseline} />
            {rotation.scenario && <RotationList label={es.reportCopy.scenario} result={rotation.scenario} />}
            <small className="muted">
              {es.reportCopy.rotationNote} {rotation.baseline.methodology}
            </small>
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
  const referenceYear = useTwinStore((s) => s.referenceYear);
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
        referenceYear={referenceYear}
        rotation={rotation?.farmId === farmId ? rotation : null}
      />
    </div>
  );
}
