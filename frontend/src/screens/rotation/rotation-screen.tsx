import { useEffect, useRef, useState } from "react";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";
import { useStageStore } from "../../store/stage-store";
import { useRotationView } from "../../store/rotation-store";
import { recommendRotation, type RotationRequest, type RotationResponse } from "./rotation-api";
import { isRecord } from "../../types/guards";
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
    const label: Record<string, string> = { t_mean: "Temperatura media", rain_mm: "Precipitación acumulada", soil_ph: "pH del suelo", soil_awc: "Agua disponible", t_extreme_days: "Días de temperatura extrema", start: "Inicio", end: "Fin", farm_id: "Parcela" };
    if (val === undefined || typeof val === "object" && val !== null) return null;
    return <div key={key}><dt>{label[key] ?? key.replaceAll("_", " ")}</dt><dd>{val === null ? "No declarado" : typeof val === "number" ? val.toFixed(2) : String(val)}{key === "t_mean" ? " °C" : key === "rain_mm" ? " mm" : ""}{key === "soil_ph" && val !== null ? " · Declarado" : ""}{state && <small> · {state}</small>}{source && <small> · {source}</small>}</dd></div>;
  })}</dl>;
}

function Ranking({ result, title }: { result: RotationResponse; title: string }) {
  return <section className="rotation-ranking"><h2>{title}</h2>
    {result.recommendations.some((item, i, list) => list.some((other, j) => j !== i && other.overall_score === item.overall_score)) && <p className="muted">Hay índices empatados. El orden entre ellos es determinista y no demuestra que una secuencia sea agronómicamente superior.</p>}
    {result.recommendations.length === 0 ? <p>No hay secuencias con los filtros elegidos.</p> :
      result.recommendations.map((item, i) => <article className="rotation-card" key={`${item.sequence.join("-")}-${i}`}>
        <header><div><span className="eyebrow">OPCIÓN {i + 1}{result.recommendations.some((other, j) => j !== i && other.overall_score === item.overall_score) ? " · ÍNDICE EMPATADO" : ""}</span><h3>{item.cycles.map((c) => c.name).join(" → ")}</h3></div>
          <div className="rotation-score"><strong>{item.overall_score.toFixed(1)}</strong><small> / 100 · índice</small></div></header>
        <div className="rotation-indicators">{([
          ["Compatibilidad lluvia", item.indicators.water], ["Compatibilidad pH", item.indicators.soil], ["Compatibilidad temperatura", item.indicators.climate],
        ] as const).map(([label, value]) => <div key={label}><small>{label}</small><strong>{fmt(value)}</strong><div className="rotation-track"><i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div></div>)}</div>
        <p className="muted">Pesos efectivos: lluvia {(item.weights.water * 100).toFixed(0)} % · pH {(item.weights.soil * 100).toFixed(0)} % · temperatura {(item.weights.climate * 100).toFixed(0)} %</p>
        <ol className="rotation-cycles">{item.cycles.map((cycle) => <li key={`${cycle.cycle}-${cycle.crop_id}`}><strong>Ciclo {cycle.cycle}: {cycle.name}</strong><span>{cycle.family} · Lluvia {cycle.rainfall_fit.toFixed(1)} · Temperatura {cycle.temperature_fit.toFixed(1)}{cycle.ph_fit !== null ? ` · pH ${cycle.ph_fit.toFixed(1)}` : " · pH sin declarar"}</span></li>)}</ol>
        {item.warnings.length > 0 && <details><summary>Supuestos y limitaciones ({item.warnings.length})</summary><ul>{item.warnings.map((warning, n) => <li key={`${warning}-${n}`}>{warning}</li>)}</ul></details>}
      </article>)}
    {result.warnings.length > 0 && <div className="rotation-warning"><strong>Avisos</strong><ul>{result.warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}</ul></div>}
  </section>;
}

export default function RotationScreen() {
  const farmId = useParcelStore((s) => s.farmId);
  const farm = useTwinStore((s) => s.farm);
  const span = useTwinStore((s) => s.span);
  const twinReady = useTwinStore((s) => s.baseline !== null && !s.loading);
  const close = useRotationView((s) => s.close);
  const [start, setStart] = useState(span.start);
  const [end, setEnd] = useState(span.end);
  const [cycles, setCycles] = useState(3);
  const [previous, setPrevious] = useState("");
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
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { abort.current?.abort(); setLoading(false); setError(null); setStart(span.start); setEnd(span.end); setBaseline(null); setScenario(null); setSubmitted(null); }, [farmId, span.start, span.end]);

  function invalidate() {
    abort.current?.abort();
    setLoading(false); setError(null); setBaseline(null); setScenario(null); setSubmitted(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 730 || Object.values(weights).every((v) => v === 0)) { setError("El periodo debe ser de hasta 730 días y al menos una prioridad debe ser mayor que cero."); return; }
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null); setBaseline(null); setScenario(null);
    const body: RotationRequest = {
      farm_id: farmId, start, end, cycles, top_k: 3, exclude_same_family: sameFamily, weights,
      scenario: { temp_delta_c: 0, precip_factor: 1 },
      ...(previous ? { previous_crop: previous } : {}), ...(ph.trim() ? { soil_ph: Number(ph) } : {}),
    };
    try {
      const [base, alternative] = await Promise.all([
        recommendRotation(body, controller.signal),
        ...(rain !== 0 || temperature !== 0 ? [recommendRotation({ ...body, scenario: { temp_delta_c: temperature, precip_factor: 1 + rain / 100 } }, controller.signal)] : []),
      ]);
      if (!controller.signal.aborted && base) { setBaseline(base); setScenario(alternative ?? null); setSubmitted(rain !== 0 || temperature !== 0 ? `Lluvia ${rain > 0 ? "+" : ""}${rain} % · temperatura ${temperature > 0 ? "+" : ""}${temperature} °C` : null); }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "No se pudo obtener el ranking."); setLoading(false); controller.abort(); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <section className="rotation-screen" aria-labelledby="rotation-title">
    <div className="rotation-header"><div><span className="eyebrow">AGROX · ECOCROP</span><h1 id="rotation-title">Rotaciones de cultivo</h1>
      <p>{farm?.farm.name ?? farmId} · compara secuencias para las condiciones disponibles.</p></div>
      <button className="ghost-button" type="button" onClick={close}>Volver a la vista anterior</button></div>
    <div className="rotation-disclaimer">Índices comparativos exploratorios, no probabilidades ni pronósticos de rendimiento. Las reglas y el modelo requieren validación en campo.</div>
    <div className="rotation-layout"><form className="rotation-form" onChange={invalidate} onSubmit={(e) => void run(e)}>
      <section className="card"><h2>Datos de la parcela</h2><p className="muted">Se usa el clima disponible para esta ubicación y periodo; la compatibilidad con suelo requiere pH declarado.</p>
        <div className="rotation-grid"><label>Desde<input type="date" required value={start} max={end} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Hasta<input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Ciclos<select value={cycles} onChange={(e) => setCycles(Number(e.target.value))}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          <label>pH declarado (opcional)<input type="number" min={0} max={14} step="0.1" placeholder="Sin declarar" value={ph} onChange={(e) => setPh(e.target.value)} /></label>
          <label>Cultivo anterior<select value={previous} onChange={(e) => setPrevious(e.target.value)}><option value="">No declarado</option>{crops.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        <label className="rotation-checkbox"><input type="checkbox" checked={sameFamily} onChange={(e) => setSameFamily(e.target.checked)} /> Evitar familia botánica consecutiva</label><p className="muted">Filtro opcional; su aplicación depende del cultivo y del manejo local.</p>
      </section>
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
      {baseline && <><div className="card"><h2>Datos utilizados</h2><InputDetails inputs={baseline.inputs} /><p className="muted">{baseline.methodology} · Clima: {String(baseline.inputs.climate_source ?? "—")} · {baseline.inputs.climate_data_state === "SYNTHETIC" ? "Sintético" : baseline.inputs.climate_data_state === "MEASURED" ? "Medido" : String(baseline.inputs.climate_data_state ?? "—")} · Índice: {baseline.data_state === "SYNTHETIC" ? "Sintético" : "Estimado"}</p><p className="muted">Las secuencias se comparan aquí; aún no modifican la escena 3D.</p></div><Ranking result={baseline} title="Clima de referencia" /></>}
      {scenario && <><div className="rotation-disclaimer">Escenario simulado: {submitted}. El gemelo aplica estos cambios a su ventana {span.start} — {span.end}; la rotación no cambia automáticamente el cultivo ni simula varios años.
        <div><button type="button" className="ghost-button" disabled={!twinReady} onClick={() => {
          useTwinStore.getState().setControls({ precipPct: rain, tempDelta: temperature, irrigation: "NONE", forkFromCurrent: false, monteCarlo: false });
          useStageStore.getState().goTo("twin"); close();
        }}>Aplicar escenario al gemelo</button>{!twinReady && <small> Carga primero los datos de la parcela.</small>}</div>
      </div><Ranking result={scenario} title="Escenario climático" /></>}
    </div></div>
  </section>;
}
