import { useEffect, useRef, useState } from "react";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore, type RotationPreview } from "../../store/twin-store";
import { useStageStore } from "../../store/stage-store";
import { useModuleView } from "../../store/module-store";
import { useRotationView } from "../../store/rotation-store";
import { useHistoryStore } from "../../store/history-store";
import { openFromHistory } from "../../store/open-parcel";
import { displayName } from "../../lib/parcel-history";
import { recommendRotation, type RotationRecommendation, type RotationRequest, type RotationResponse, type RotationWindow } from "./rotation-api";
import { isRecord } from "../../types/guards";
import { periodError, rotationPresets, splitPeriod, windowsError } from "../../lib/rotation-dates";
import "./rotation.css";

const crops: [string, string][] = [
  ["corn", "Maíz"], ["bean", "Frijol"], ["soybean", "Soya"], ["wheat", "Trigo"],
  ["sorghum", "Sorgo"], ["chickpea", "Garbanzo"], ["cover_vetch", "Vicia (cobertura)"],
];
const fmt = (v: number | null) => v === null ? "Sin dato" : v.toFixed(1);
const EMPTY = { water: 1, soil: 1, climate: 1 };

function InputDetails({ inputs }: { inputs: Record<string, unknown> }) {
  const keys = ["start", "end", "days", "t_mean", "rain_mm", "soil_ph"];
  const entries = keys.map((key) => [key, inputs[key]] as const);
  return <dl className="rotation-inputs">{entries.map(([key, value]) => {
    const val = isRecord(value) ? value.value : value;
    const source = isRecord(value) && typeof value.source === "string" ? value.source : "";
    const state = isRecord(value) && typeof value.data_state === "string" ? value.data_state : "";
    const label: Record<string, string> = { days: "Días", t_mean: "Temperatura media", rain_mm: "Precipitación acumulada", soil_ph: "pH del suelo", soil_awc: "Agua disponible", t_extreme_days: "Días de temperatura extrema", start: "Inicio", end: "Fin", farm_id: "Parcela" };
    if (val === undefined || typeof val === "object" && val !== null) return null;
    return <div key={key}><dt>{label[key] ?? key.replaceAll("_", " ")}</dt><dd>{val === null ? "No declarado" : typeof val === "number" ? val.toFixed(2) : String(val)}{key === "t_mean" ? " °C" : key === "rain_mm" ? " mm" : ""}{key === "soil_ph" && val !== null ? " · Declarado" : ""}{state && <small> · {state}</small>}{source && <small> · {source}</small>}</dd></div>;
  })}</dl>;
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
  return <section className="rotation-ranking"><h2>{title}</h2>
    {[...frequencies.values()].some((count) => count > 1) && <p className="muted">En los empates se priorizan menos repeticiones de familia botánica.</p>}
    {result.recommendations.length === 0 ? <p>No hay secuencias con los filtros elegidos.</p> :
      result.recommendations.map((item, i) => <article className="rotation-card" key={`${item.sequence.join("-")}-${i}`}>
        <header><div><span className="eyebrow">OPCIÓN {i + 1}{(frequencies.get(indexOf(item)) ?? 0) > 1 ? " · ÍNDICE EMPATADO" : ""}</span><h3>{item.cycles.map((c) => c.name).join(" → ")}</h3></div>
          <div className="rotation-score"><strong>{item.overall_score.toFixed(1)}</strong><small> / 100 · índice</small></div></header>
        <div className="rotation-indicators">{([
          ["Compatibilidad lluvia", item.indicators.water], ["Compatibilidad pH", item.indicators.soil], ["Compatibilidad temperatura", item.indicators.climate],
        ] as const).map(([label, value]) => <div key={label}><small>{label}</small><strong>{fmt(value)}</strong><div className="rotation-track"><i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div></div>)}</div>
        <p className="muted">Pesos efectivos: lluvia {(item.weights.water * 100).toFixed(0)} % · pH {(item.weights.soil * 100).toFixed(0)} % · temperatura {(item.weights.climate * 100).toFixed(0)} %</p>
        {item.rotation && item.agroclimatic_score !== undefined && <p className="muted">Clima y suelo {item.agroclimatic_score.toFixed(1)} · Rotación {item.rotation.index.toFixed(1)} (cambio de familia, leguminosas y diversidad)</p>}
        {item.explanation && item.explanation.length > 0 && <ul className="muted">{item.explanation.map((line) => <li key={line}>{line}</li>)}</ul>}
        {item.family_repeats !== undefined && <p className="muted">Repeticiones consecutivas de familia: {item.family_repeats}</p>}
        <ol className="rotation-cycles">{item.cycles.map((cycle) => <li key={`${cycle.cycle}-${cycle.crop_id}`}><strong>Ciclo {cycle.cycle}: {cycle.name}</strong><span>{cycle.family} · Lluvia {cycle.rainfall_fit.toFixed(1)} · Temperatura {cycle.temperature_fit.toFixed(1)}{cycle.ph_fit !== null ? ` · pH ${cycle.ph_fit.toFixed(1)}` : " · pH sin declarar"}</span>
          {cycle.window && <span>{cycle.window.start} a {cycle.window.end}</span>}
          {cycle.warnings.filter((warning) => warning.startsWith("La ventana") || warning.startsWith("Lluvia de")).map((warning) => <span key={warning}>{warning}</span>)}
          {cycle.twin_supported ? (
            <button className="ghost-button rotation-preview" type="button" disabled={!canPreview} onClick={() => onPreview(item, cycle.cycle - 1)}>
              Simular ciclo {cycle.cycle} en 3D
            </button>
          ) : <span>Sin parámetros para el gemelo 3D.</span>}
        </li>)}</ol>
        {item.warnings.length > 0 && <details><summary>Supuestos y limitaciones ({item.warnings.length})</summary><ul>{item.warnings.map((warning, n) => <li key={`${warning}-${n}`}>{warning}</li>)}</ul></details>}
      </article>)}
    {result.warnings.length > 0 && <div className="rotation-warning"><strong>Avisos</strong><ul>{result.warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}</ul></div>}
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
  const [cycles, setCycles] = useState(3);
  const [twinOnly, setTwinOnly] = useState(true);
  const [useWindows, setUseWindows] = useState(false);
  const [windows, setWindows] = useState<RotationWindow[]>(Array.from({ length: 4 }, () => ({ start: "", end: "" })));
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previous, setPrevious] = useState("");
  const [startCrop, setStartCrop] = useState("");
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
    setPrevious(""); setStartCrop(""); setPh(""); setUseWindows(false);
    setWindows(Array.from({ length: 4 }, () => ({ start: "", end: "" })));
  }, [farmId]);

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
    if (weights.water + weights.climate + (ph.trim() ? weights.soil : 0) === 0) {
      setError("Da prioridad a lluvia o temperatura, o declara el pH para priorizar suelo.");
      return;
    }
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null); setBaseline(null); setScenario(null);
    const body: RotationRequest = {
      farm_id: farmId, start: from, end: to, cycles, top_k: 3, exclude_same_family: sameFamily, weights,
      twin_only: twinOnly, ...(cycleWindows ? { cycle_windows: cycleWindows } : {}),
      scenario: { temp_delta_c: 0, precip_factor: 1 },
      ...(previous ? { previous_crop: previous } : {}), ...(startCrop ? { start_crop: startCrop } : {}), ...(ph.trim() ? { soil_ph: Number(ph) } : {}),
    };
    try {
      const [base, alternative] = await Promise.all([
        recommendRotation(body, controller.signal),
        ...(rain !== 0 || temperature !== 0 ? [recommendRotation({ ...body, scenario: { temp_delta_c: temperature, precip_factor: 1 + rain / 100 } }, controller.signal)] : []),
      ]);
      if (!controller.signal.aborted && base) { useModuleView.getState().setRotation({ farmId, baseline: base, scenario: alternative ?? null }); setBaseline(base); setScenario(alternative ?? null); setSubmitted(rain !== 0 || temperature !== 0 ? `Lluvia ${rain > 0 ? "+" : ""}${rain} % · temperatura ${temperature > 0 ? "+" : ""}${temperature} °C` : null); }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "No se pudo obtener el ranking."); setLoading(false); controller.abort(); }
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
    };
    try {
      await previewRotation(preview);
      if (mounted.current) {
        useStageStore.getState().goTo("twin");
        close();
      }
    } catch (err) {
      if (mounted.current && !(err instanceof DOMException && err.name === "AbortError")) {
        setPreviewError(err instanceof Error ? err.message : "No se pudo simular el ciclo.");
      }
    }
  }

  return <section className="rotation-screen" aria-labelledby="rotation-title">
    <div className="rotation-header"><div><span className="eyebrow">AGROX · ECOCROP</span><h1 id="rotation-title">Rotaciones de cultivo</h1>
      <p>{farm?.farm.name ?? farmId} · compara secuencias para las condiciones disponibles.</p></div>
      <button className="ghost-button" type="button" onClick={close}>Volver a la vista anterior</button></div>
    <div className="rotation-disclaimer">Índices comparativos exploratorios, no probabilidades ni pronósticos de rendimiento. Las reglas y el modelo requieren validación en campo.</div>
    <div className="rotation-layout"><form className="rotation-form" onChange={invalidate} onSubmit={(e) => void run(e)}>
      <section className="card"><h2>Datos de la parcela</h2>
        <label>Parcela<select value={farmId} onChange={(e) => {
          const rec = parcels.find((p) => p.farmId === e.target.value);
          setParcelError(null);
          if (rec && rec.farmId !== farmId) void openFromHistory(rec).then(setParcelError);
        }}>{!selected && <option value={farmId}>{farm?.farm.name ?? farmId}</option>}
          {parcels.map((p) => <option key={p.farmId} value={p.farmId}>{displayName(p)}</option>)}</select></label>
        <p className="muted">{farm?.farm.name ?? (selected ? displayName(selected) : farmId)}{(farm?.farm.area_ha ?? selected?.areaHa) != null ? ` · ${Number(farm?.farm.area_ha ?? selected?.areaHa).toFixed(1)} ha` : ""}</p>
        {parcelError && <div className="error-box" role="alert">{parcelError}</div>}
        <p className="muted">Se usa el clima disponible para esta ubicación y periodo; la compatibilidad con suelo requiere pH declarado.</p>
        <div className="rotation-grid">{!useWindows && <>
          <label>Desde<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Hasta<input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </>}
          <label>Ciclos<select value={cycles} onChange={(e) => {
            const n = Number(e.target.value);
            // Keep the overall period and re-split it when per-cycle dates are on
            if (useWindows) setWindows(splitPeriod(windows[0]?.start ?? start, windows[cycles - 1]?.end ?? end, n));
            setCycles(n);
          }}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          <label>pH declarado (opcional)<input type="number" min={0} max={14} step="0.1" placeholder="Sin declarar" value={ph} onChange={(e) => setPh(e.target.value)} /></label>
          <label>Cultivo anterior<select value={previous} onChange={(e) => setPrevious(e.target.value)}><option value="">No declarado</option>{crops.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Cultivo inicial<select value={startCrop} onChange={(e) => setStartCrop(e.target.value)}><option value="">Automático</option>{crops.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        <label className="rotation-checkbox"><input type="checkbox" checked={sameFamily} onChange={(e) => setSameFamily(e.target.checked)} /> Evitar familia botánica consecutiva</label><p className="muted">Filtro opcional; su aplicación depende del cultivo y del manejo local.</p>
        <label className="rotation-checkbox"><input type="checkbox" checked={twinOnly} onChange={(e) => setTwinOnly(e.target.checked)} /> Solo cultivos que se pueden simular en el gemelo</label>
        {!useWindows && <div className="rotation-presets" role="group" aria-label="Periodos rápidos">
          {rotationPresets(Number(span.start.slice(0, 4)) || new Date().getFullYear(), new Date().toISOString().slice(0, 10)).map((p) =>
            <button key={p.id} type="button" className="ghost-button" onClick={() => { setStart(p.range.start); setEnd(p.range.end); invalidate(); }}>{p.label}</button>)}
        </div>}
        <label className="rotation-checkbox"><input type="checkbox" checked={useWindows} onChange={(e) => {
          // Start filled with consecutive windows so every cycle has valid, editable dates
          if (e.target.checked) setWindows(splitPeriod(start, end, cycles));
          setUseWindows(e.target.checked);
        }} /> Usar fechas distintas por ciclo</label>
        {useWindows && windows.slice(0, cycles).map((window, index) => (
          <fieldset key={index} className="rotation-window">
            <legend>Ciclo {index + 1}</legend>
            <div className="rotation-grid">
              {(["start", "end"] as const).map((key) => (
                <label key={key}>{key === "start" ? "Desde" : "Hasta"}
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
      <details className="card rotation-help"><summary>¿Cómo subir el índice?</summary>
        <ul>
          <li><strong>Lluvia:</strong> la lluvia de tu ventana se lleva a la duración del ciclo del cultivo y se compara con su rango óptimo EcoCrop. Una ventana más lluviosa o más seca que ese rango baja el valor.</li>
          <li><strong>Temperatura:</strong> la temperatura media de la ventana debe caer dentro del rango óptimo del cultivo; cambiar las fechas de siembra mueve este valor.</li>
          <li><strong>pH:</strong> declara el pH de tu suelo para activar este componente; sin declararlo no cuenta en el índice. Cuanto más cerca del rango óptimo del cultivo, mayor el valor.</li>
          <li>El índice es comparativo: 100 significa que todos los factores están en su rango óptimo para la ventana y el lugar elegidos. No es una probabilidad ni un rendimiento esperado.</li>
        </ul></details>
      <section className="card"><h2>Prioridades</h2><p className="muted">Los pesos se normalizan al comparar alternativas.</p>
        {([ ["water", "Agua"], ["soil", "Suelo"], ["climate", "Clima"] ] as const).map(([key, label]) => <label className="rotation-slider" key={key}>{label} <strong>{weights[key]}</strong><input type="range" min={0} max={10} value={weights[key]} onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))} /></label>)}
      </section>
      <section className="card"><h2>¿Qué pasaría si…?</h2><p className="muted">Ajustes simulados sobre el clima de referencia.</p>
        <label className="rotation-slider">Cambio de precipitación <strong>{rain > 0 ? "+" : ""}{rain} %</strong><input type="range" min={-80} max={50} step={5} value={rain} onChange={(e) => setRain(Number(e.target.value))} /></label>
        <label className="rotation-slider">Cambio de temperatura <strong>{temperature > 0 ? "+" : ""}{temperature} °C</strong><input type="range" min={-3} max={5} step={0.5} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label>
      </section>
      <button className="play-button rotation-submit" type="submit" disabled={loading}>{loading ? "Calculando…" : "Comparar rotaciones"}</button>
      {error && <div className="error-box" role="alert">{error}</div>}
    </form><div className="rotation-results">
      {!baseline && !loading && <div className="card rotation-empty"><h2>Compara tres alternativas</h2><p>Elige el periodo y tus prioridades. Se mostrará el índice y el desglose disponible para cada secuencia.</p></div>}
      {loading && <div className="card" role="status">Consultando datos y calculando secuencias…</div>}
      {previewError && <div className="error-box" role="alert">{previewError}</div>}
      {baseline && !twinReady && <p className="muted" role="status">El gemelo está preparando la simulación de la parcela.</p>}
      {baseline && <>
        <div className="card"><h2>Datos utilizados</h2><InputDetails inputs={baseline.inputs} />
          <p className="muted">{baseline.methodology} · Clima: {String(baseline.inputs.climate_source ?? "—")} · {baseline.inputs.climate_data_state === "SYNTHETIC" ? "Sintético" : baseline.inputs.climate_data_state === "MEASURED" ? "Medido" : String(baseline.inputs.climate_data_state ?? "—")}</p>
        </div>
        <Ranking result={baseline} title="Clima de referencia" canPreview={twinReady} onPreview={(item, index) => void openPreview(item, index, false)} />
      </>}
      {scenario && <>
        <div className="rotation-disclaimer">Escenario simulado: {submitted}.</div>
        <Ranking result={scenario} title="Escenario climático" canPreview={twinReady} onPreview={(item, index) => void openPreview(item, index, true)} />
      </>}
    </div></div>
  </section>;
}
