import { useEffect, useRef, useState } from "react";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore, type RotationPreview } from "../../store/twin-store";
import { useStageStore } from "../../store/stage-store";
import { useModuleView } from "../../store/module-store";
import { useRotationView } from "../../store/rotation-store";
import { useHistoryStore } from "../../store/history-store";
import { openFromHistory } from "../../store/open-parcel";
import { displayName } from "../../lib/parcel-history";
import { recommendRotation, startCropOptions, type RotationRecommendation, type RotationRequest, type RotationResponse, type RotationWindow } from "./rotation-api";
import { isRecord } from "../../types/guards";
import { periodError, rotationPresets, splitPeriod, windowsError } from "../../lib/rotation-dates";
import { getWeatherCoverage, type WeatherCoverage } from "../../lib/weather-coverage";
import { DataStateBadge } from "../../components/data-state-badge";
import { DataStateLegend } from "../../components/explain/data-state-legend";
import { HowCalculated } from "../../components/explain/how-calculated";
import { ModelNote } from "../../components/explain/model-note";
import { ReadingChip } from "../../components/explain/reading-chip";
import { Term } from "../../components/explain/term";
import { es } from "../../i18n/es";
import { fitReading, scoreReading } from "../../lib/readings";
import { isDataState } from "../../types/guards";
import "./rotation.css";

// ─────────────────────────────────────────
// Section: Rotation comparison (EcoCrop comparative index; every figure explained in plain words)
// ─────────────────────────────────────────

const crops: [string, string][] = Object.entries(es.rotation.crops);
const fmt = (v: number | null) => v === null ? es.rotation.noData : v.toFixed(1);
const EMPTY = { water: 1, soil: 1, climate: 1 };

function InputDetails({ inputs }: { inputs: Record<string, unknown> }) {
  const keys = ["start", "end", "days", "t_mean", "rain_mm", "soil_ph"];
  const entries = keys.map((key) => [key, inputs[key]] as const);
  return <dl className="rotation-inputs">{entries.map(([key, value]) => {
    const val = isRecord(value) ? value.value : value;
    const source = isRecord(value) && typeof value.source === "string" ? value.source : "";
    const state = isRecord(value) && typeof value.data_state === "string" ? value.data_state : "";
    const label = es.rotation.inputLabels;
    if (val === undefined || typeof val === "object" && val !== null) return null;
    return <div key={key}><dt>{label[key] ?? key.replaceAll("_", " ")}</dt><dd>{val === null ? es.rotation.notDeclaredValue : typeof val === "number" ? val.toFixed(2) : String(val)}{key === "t_mean" ? " °C" : key === "rain_mm" ? " mm" : ""}{key === "soil_ph" && val !== null ? ` · ${es.rotation.declared}` : ""}{state && (isDataState(state) ? <> <DataStateBadge state={state} compact /></> : <small> · {state}</small>)}{source && <small> · {source}</small>}</dd></div>;
  })}</dl>;
}

// The index is (1 − w_rot)·agroclimatic + w_rot·rotation since the rotation component was added; showing only the
// weighted EcoCrop sum would not add up to the displayed score, so the arithmetic follows the fields the API returns.
function scoreArithmetic(item: RotationRecommendation): string {
  const agro = `${item.weights.water.toFixed(2)}·${fmt(item.indicators.water)} + ${item.weights.soil.toFixed(2)}·${fmt(item.indicators.soil)} + ${item.weights.climate.toFixed(2)}·${fmt(item.indicators.climate)}`;
  if (!item.rotation || item.agroclimatic_score === undefined || item.rotation_weight === undefined) return `${agro} ≈ ${item.overall_score.toFixed(1)}`;
  const w = item.rotation_weight;
  return `${es.rotation.agroLabel} = ${agro} ≈ ${item.agroclimatic_score.toFixed(1)} · ${es.rotation.indexLabel} = ${(1 - w).toFixed(2)}·${item.agroclimatic_score.toFixed(1)} + ${w.toFixed(2)}·${item.rotation.index.toFixed(1)} ≈ ${item.overall_score.toFixed(1)}`;
}

interface RankingProps {
  result: RotationResponse;
  title: string;
  canPreview: boolean;
  onPreview: (item: RotationRecommendation, index: number) => void;
}

function Ranking({ result, title, canPreview, onPreview }: RankingProps) {
  const indexOf = (item: RotationRecommendation) => item.score ?? item.overall_score;
  const frequencies = new Map<number, number>();
  for (const item of result.recommendations) {
    const score = indexOf(item);
    frequencies.set(score, (frequencies.get(score) ?? 0) + 1);
  }
  const allScores = result.recommendations.map(indexOf);
  return <section className="rotation-ranking"><h2>{title}</h2>
    {[...frequencies.values()].some((count) => count > 1) && <p className="muted">{es.rotation.tieNote}</p>}
    {result.recommendations.length === 0 ? <p className="empty-state">{es.rotation.noSequences}</p> :
      result.recommendations.map((item, i) => <article className="rotation-card" key={`${item.sequence.join("-")}-${i}`}>
        <header><div><span className="eyebrow">{es.rotation.option(i + 1, (frequencies.get(indexOf(item)) ?? 0) > 1)}</span><h3>{item.cycles.map((c) => c.name).join(" → ")}</h3></div>
          <div className="rotation-score" data-testid="rotation-score"><strong>{item.overall_score.toFixed(1)}</strong><small>{es.rotation.scoreSuffix}</small>
            <ReadingChip reading={scoreReading(indexOf(item), allScores)} /></div></header>
        <p className="meaning"><Term id="score" />: {es.meaning.score}</p>
        <div className="rotation-indicators">{([
          [es.rotation.water, item.indicators.water, es.meaning.waterFit], [es.rotation.soil, item.indicators.soil, es.meaning.phFit], [es.rotation.climate, item.indicators.climate, es.meaning.tempFit],
        ] as const).map(([label, value, meaning]) => <div key={label} title={meaning}><small>{label}</small><strong>{fmt(value)}</strong><div className="rotation-track"><i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div><ReadingChip reading={fitReading(value)} /></div>)}</div>
        <p className="muted">{es.rotation.weights((item.weights.water * 100).toFixed(0), (item.weights.soil * 100).toFixed(0), (item.weights.climate * 100).toFixed(0))}</p>
        {item.rotation && item.agroclimatic_score !== undefined && <p className="muted">{es.rotation.components(item.agroclimatic_score.toFixed(1), item.rotation.index.toFixed(1))}</p>}
        {item.explanation && item.explanation.length > 0 && <ul className="muted">{item.explanation.map((line) => <li key={line}>{line}</li>)}</ul>}
        <HowCalculated id="score" current={scoreArithmetic(item)} />
        {item.family_repeats !== undefined && <p className="muted">{es.rotation.familyRepeats(item.family_repeats)}</p>}
        <ol className="rotation-cycles">{item.cycles.map((cycle) => <li key={`${cycle.cycle}-${cycle.crop_id}`}><strong>{es.rotation.cycle(cycle.cycle, cycle.name)}</strong><span>{es.rotation.cycleDetail(cycle.family, cycle.rainfall_fit.toFixed(1), cycle.temperature_fit.toFixed(1), cycle.ph_fit !== null ? cycle.ph_fit.toFixed(1) : null)}</span>
          {cycle.window && <span>{es.rotation.window(cycle.window.start, cycle.window.end)}</span>}
          {cycle.warnings.filter((warning) => warning.startsWith("La ventana") || warning.startsWith("Lluvia de")).map((warning) => <span key={warning}>{warning}</span>)}
          {cycle.twin_supported ? (
            <button className="ghost-button rotation-preview" type="button" disabled={!canPreview} onClick={() => onPreview(item, cycle.cycle - 1)}>
              {es.rotation.simulate(cycle.cycle)}
            </button>
          ) : <span>{es.rotation.noTwin}</span>}
        </li>)}</ol>
        {item.warnings.length > 0 && <details><summary>{es.rotation.assumptions(item.warnings.length)}</summary><ul>{item.warnings.map((warning, n) => <li key={`${warning}-${n}`}>{warning}</li>)}</ul></details>}
      </article>)}
    {result.warnings.length > 0 && <div className="rotation-warning"><strong>{es.rotation.warnings}</strong><ul>{result.warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}</ul></div>}
  </section>;
}

export default function RotationScreen() {
  const farmId = useParcelStore((s) => s.farmId);
  const farm = useTwinStore((s) => s.farm);
  const span = useTwinStore((s) => s.span);
  const twinReady = useTwinStore((s) => s.baseline?.farm_id === farmId && !s.loading && !s.simulating);
  const previewRotation = useTwinStore((s) => s.previewRotation);
  const close = useRotationView((s) => s.close);
  const parcels = useHistoryStore((s) => s.items);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const selected = parcels.find((p) => p.farmId === farmId);
  const [start, setStart] = useState(span.start);
  const [end, setEnd] = useState(span.end);
  const [referenceYear, setReferenceYear] = useState("");
  const [coverage, setCoverage] = useState<WeatherCoverage | null>(null);
  const [coverageError, setCoverageError] = useState(false);
  const [cycles, setCycles] = useState(3);
  const [twinOnly, setTwinOnly] = useState(true);
  const [useWindows, setUseWindows] = useState(false);
  const [windows, setWindows] = useState<RotationWindow[]>(Array.from({ length: 4 }, () => ({ start: "", end: "" })));
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previous, setPrevious] = useState("");
  const [startCrop, setStartCrop] = useState("");
  const [startCropNotice, setStartCropNotice] = useState<string | null>(null);
  const catalog = useParcelStore((s) => s.catalog);
  const [sameFamily, setSameFamily] = useState(false);
  const [ph, setPh] = useState("");
  const [rain, setRain] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [weights, setWeights] = useState(EMPTY);
  const [baseline, setBaseline] = useState<RotationResponse | null>(null);
  const [scenario, setScenario] = useState<RotationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const initialSpan = useRef(span);
  initialSpan.current = span;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    abort.current?.abort();
    setLoading(false); setError(null); setPreviewError(null);
    setStart(initialSpan.current.start); setEnd(initialSpan.current.end);
    setBaseline(null); setScenario(null); setSubmitted(null);
    setPrevious(""); setStartCrop(""); setStartCropNotice(null); setPh(""); setUseWindows(false); setReferenceYear("");
    setWindows(Array.from({ length: 4 }, () => ({ start: "", end: "" })));
  }, [farmId]);

  useEffect(() => {
    const controller = new AbortController();
    setCoverage(null); setCoverageError(false);
    void getWeatherCoverage(farmId, controller.signal)
      .then(setCoverage)
      .catch(() => { if (!controller.signal.aborted) setCoverageError(true); });
    return () => controller.abort();
  }, [farmId]);

  const twinIds = catalog ? catalog.crops.map((c) => c.crop_id) : null;
  const startOptions = startCropOptions(crops, twinIds, twinOnly);

  // A filter change can leave the chosen starting crop invalid; clear it and say why instead of failing on submit.
  function changeTwinOnly(next: boolean) {
    setTwinOnly(next);
    const valid = startCropOptions(crops, twinIds, next);
    if (startCrop && !valid.some(([id]) => id === startCrop)) {
      setStartCropNotice(es.rotation.startCropReset(es.rotation.crops[startCrop] ?? startCrop));
      setStartCrop("");
    }
  }

  function invalidate() {
    abort.current?.abort();
    setLoading(false); setError(null); setPreviewError(null); setBaseline(null); setScenario(null); setSubmitted(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const cycleWindows = useWindows ? windows.slice(0, cycles) : undefined;
    const from = cycleWindows?.[0]?.start ?? start;
    const to = cycleWindows?.at(-1)?.end ?? end;
    const rangeError = cycleWindows ? windowsError(cycleWindows) : periodError(from, to);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    if (coverage && (from < coverage.start || to > coverage.end) && !referenceYear) {
      setError(es.weatherReference.required);
      return;
    }
    if (weights.water + weights.climate + (ph.trim() ? weights.soil : 0) === 0) {
      setError(es.rotation.noWeights);
      return;
    }
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null); setBaseline(null); setScenario(null);
    const body: RotationRequest = {
      farm_id: farmId, start: from, end: to, cycles, top_k: 3, exclude_same_family: sameFamily, weights,
      reference_year: referenceYear ? Number(referenceYear) : null,
      twin_only: twinOnly, ...(cycleWindows ? { cycle_windows: cycleWindows } : {}),
      scenario: { temp_delta_c: 0, precip_factor: 1 },
      ...(previous ? { previous_crop: previous } : {}), ...(startCrop ? { start_crop: startCrop } : {}), ...(ph.trim() ? { soil_ph: Number(ph) } : {}),
    };
    try {
      const [base, alternative] = await Promise.all([
        recommendRotation(body, controller.signal),
        ...(rain !== 0 || temperature !== 0 ? [recommendRotation({ ...body, scenario: { temp_delta_c: temperature, precip_factor: 1 + rain / 100 } }, controller.signal)] : []),
      ]);
      if (!controller.signal.aborted && base) { useModuleView.getState().setRotation({ farmId, baseline: base, scenario: alternative ?? null }); setBaseline(base); setScenario(alternative ?? null); setSubmitted(rain !== 0 || temperature !== 0 ? es.rotation.scenarioSummary(`${rain > 0 ? "+" : ""}${rain}`, `${temperature > 0 ? "+" : ""}${temperature}`) : null); }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : es.rotation.failed); setLoading(false); controller.abort(); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  async function openPreview(item: RotationRecommendation, index: number, hypothetical: boolean) {
    setPreviewError(null);
    const preview: RotationPreview = {
      farmId,
      index,
      cycles: item.cycles.map((cycle) => ({
        cropId: cycle.crop_id, name: cycle.name,
        span: cycle.window ?? { start, end },
        supported: Boolean(cycle.twin_supported),
      })),
      precipPct: hypothetical ? rain : 0,
      tempDelta: hypothetical ? temperature : 0,
      referenceYear: referenceYear ? Number(referenceYear) : null,
      referenceStartYear: Number((useWindows ? windows[0]?.start : start)?.slice(0, 4)),
    };
    try {
      await previewRotation(preview);
      if (mounted.current) {
        useStageStore.getState().goTo("twin");
        close();
      }
    } catch (err) {
      if (mounted.current && !(err instanceof DOMException && err.name === "AbortError")) {
        setPreviewError(err instanceof Error ? err.message : es.twinCopy.cycleFailed);
      }
    }
  }

  return <section className="rotation-screen" aria-labelledby="rotation-title">
    <div className="rotation-header"><div><span className="eyebrow">{es.rotation.eyebrow}</span><h1 id="rotation-title">{es.rotation.title}</h1>
      <p>{es.rotation.subtitle(farm?.farm.name ?? farmId)}</p></div>
      <button className="ghost-button" type="button" onClick={close}>{es.rotation.back}</button></div>
    <div className="rotation-disclaimer">{es.rotation.disclaimer}</div>
    <ModelNote />
    <div className="rotation-layout"><form className="rotation-form" onChange={invalidate} onSubmit={(e) => void run(e)}>
      <section className="card"><h2>{es.rotation.farmData}</h2>
        <label>{es.rotation.parcel}<select value={farmId} onChange={(e) => {
          const rec = parcels.find((p) => p.farmId === e.target.value);
          setParcelError(null);
          if (rec && rec.farmId !== farmId) void openFromHistory(rec).then(setParcelError);
        }}>{!selected && <option value={farmId}>{farm?.farm.name ?? farmId}</option>}
          {parcels.map((p) => <option key={p.farmId} value={p.farmId}>{displayName(p)}</option>)}</select></label>
        <p className="muted">{es.rotation.parcelSummary(farm?.farm.name ?? (selected ? displayName(selected) : farmId), (farm?.farm.area_ha ?? selected?.areaHa) != null ? Number(farm?.farm.area_ha ?? selected?.areaHa).toFixed(1) : null)}</p>
        {parcelError && <div className="error-box" role="alert">{parcelError}</div>}
        <p className="muted">{es.rotation.farmDataHint}</p>
        {coverage ? <p className="muted">{es.weatherReference.coverage(coverage.start, coverage.end, coverage.available_days, coverage.missing.length)}</p> : <p className="muted">{coverageError ? es.weatherReference.unavailable : es.weatherReference.loading}</p>}
        {coverage && coverage.missing.length > 0 && <details><summary>{es.weatherReference.missingIntervals}</summary><ul>{coverage.missing.map((gap) => <li key={`${gap.start}-${gap.end}`}>{gap.start} — {gap.end}</li>)}</ul></details>}
        <label className="rotation-field">{es.weatherReference.year}
          <input type="number" min={1900} max={coverage ? Number(coverage.end.slice(0, 4)) : undefined} step={1} value={referenceYear} onChange={(e) => setReferenceYear(e.target.value)} placeholder={es.weatherReference.placeholder} />
        </label>
        {coverage && <p className="muted">{es.weatherReference.usableYears(Number(coverage.start.slice(0, 4)), Number(coverage.end.slice(0, 4)))}</p>}
        <p className="muted">{es.weatherReference.explanation}</p>
        <div className="rotation-grid">{!useWindows && <>
          <label>{es.rotation.from}<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>{es.rotation.to}<input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </>}
          <label>{es.rotation.cycles}<select value={cycles} onChange={(e) => {
            const n = Number(e.target.value);
            // Keep the overall period and re-split it when per-cycle dates are on
            if (useWindows) setWindows(splitPeriod(windows[0]?.start ?? start, windows[cycles - 1]?.end ?? end, n));
            setCycles(n);
          }}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          <label>{es.rotation.ph}<input type="number" min={0} max={14} step="0.1" placeholder={es.rotation.phPlaceholder} value={ph} onChange={(e) => setPh(e.target.value)} /></label>
          <label>{es.rotation.previous}<select value={previous} onChange={(e) => setPrevious(e.target.value)}><option value="">{es.rotation.notDeclared}</option>{crops.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>{es.rotation.startCrop}<select value={startCrop} onChange={(e) => { setStartCrop(e.target.value); setStartCropNotice(null); }}><option value="">{es.rotation.auto}</option>{startOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        {startCropNotice && <p className="rotation-notice" role="status">{startCropNotice}</p>}
        <label className="rotation-checkbox"><input type="checkbox" checked={sameFamily} onChange={(e) => setSameFamily(e.target.checked)} /> {es.rotation.sameFamily}</label><p className="muted">{es.rotation.sameFamilyHint}</p>
        <label className="rotation-checkbox"><input type="checkbox" checked={twinOnly} onChange={(e) => changeTwinOnly(e.target.checked)} /> {es.rotation.twinOnly}</label>
        {!useWindows && <div className="rotation-presets" role="group" aria-label={es.rotation.presetsAria}>
          {rotationPresets(Number(span.start.slice(0, 4)) || new Date().getFullYear(), new Date().toISOString().slice(0, 10)).map((p) =>
            <button key={p.id} type="button" className="ghost-button" onClick={() => { setStart(p.range.start); setEnd(p.range.end); invalidate(); }}>{p.label}</button>)}
        </div>}
        <label className="rotation-checkbox"><input type="checkbox" checked={useWindows} onChange={(e) => {
          // Start filled with consecutive windows so every cycle has valid, editable dates
          if (e.target.checked) setWindows(splitPeriod(start, end, cycles));
          setUseWindows(e.target.checked);
        }} /> {es.rotation.perCycle}</label>
        {useWindows && windows.slice(0, cycles).map((window, index) => (
          <fieldset key={index} className="rotation-window">
            <legend>{es.rotation.cycleLegend(index + 1)}</legend>
            <div className="rotation-grid">
              {(["start", "end"] as const).map((key) => (
                <label key={key}>{key === "start" ? es.rotation.from : es.rotation.to}
                  <input type="date" required value={window[key]} onChange={(e) => {
                    const value = e.target.value;
                    setWindows((current) => current.map((w, i) => i === index ? { ...w, [key]: value } : w));
                  }} />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>
      <details className="card rotation-help"><summary>{es.rotation.raiseTitle}</summary>
        <ul>
          {es.rotation.raise.map(([k, text]) => <li key={k}><strong>{k}:</strong> {text}</li>)}
          <li>{es.rotation.raiseNote} <Term id="ecocrop" /></li>
        </ul></details>
      <section className="card"><h2>{es.rotation.priorities}</h2><p className="muted">{es.rotation.prioritiesHint}</p>
        {(["water", "soil", "climate"] as const).map((key) => [key, es.rotation.weightLabels[key]] as const).map(([key, label]) => <label className="rotation-slider" key={key}>{label} <strong>{weights[key]}</strong><input type="range" min={0} max={10} value={weights[key]} onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))} /></label>)}
      </section>
      <section className="card"><h2>{es.rotation.whatIf}</h2><p className="muted">{es.rotation.whatIfHint}</p>
        <label className="rotation-slider">{es.rotation.precip} <strong>{rain > 0 ? "+" : ""}{rain} %</strong><input type="range" min={-80} max={50} step={5} value={rain} onChange={(e) => setRain(Number(e.target.value))} /></label>
        <label className="rotation-slider">{es.rotation.temp} <strong>{temperature > 0 ? "+" : ""}{temperature} °C</strong><input type="range" min={-3} max={5} step={0.5} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label>
      </section>
      <div className="rotation-submit-row">
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="play-button rotation-submit" type="submit" disabled={loading}>{loading ? es.rotation.calculating : es.rotation.submit}</button>
      </div>
    </form><div className="rotation-results">
      {!baseline && !loading && <div className="card rotation-empty"><h2>{es.rotation.emptyTitle}</h2><p>{es.rotation.emptyBody}</p><DataStateLegend /></div>}
      {loading && <div className="card" role="status">{es.rotation.loading}</div>}
      {previewError && <div className="error-box" role="alert">{previewError}</div>}
      {baseline && !twinReady && <p className="muted" role="status">{es.rotation.twinPreparing}</p>}
      {baseline && <>
        <div className="card"><h2>{es.rotation.inputsTitle}</h2>
          {typeof baseline.inputs.reference_year === "number" && <p className="muted" role="status"><DataStateBadge state={isDataState(baseline.data_state) ? baseline.data_state : "SIMULATED"} compact /> {es.weatherReference.active(baseline.inputs.reference_year)}</p>}
          <InputDetails inputs={baseline.inputs} />
          <p className="muted">{es.rotation.climateLine(baseline.methodology, String(baseline.inputs.climate_source ?? "—"), isDataState(baseline.inputs.climate_data_state) ? es.dataState[baseline.inputs.climate_data_state] : String(baseline.inputs.climate_data_state ?? "—"))}</p>
        </div>
        <Ranking result={baseline} title={es.rotation.reference} canPreview={twinReady} onPreview={(item, index) => void openPreview(item, index, false)} />
      </>}
      {scenario && <>
        <div className="rotation-disclaimer">{es.rotation.scenarioBanner(submitted ?? "")}</div>
        <Ranking result={scenario} title={es.rotation.scenarioTitle} canPreview={twinReady} onPreview={(item, index) => void openPreview(item, index, true)} />
      </>}
    </div></div>
  </section>;
}
