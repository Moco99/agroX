import { useState } from "react";
import GlobeScene from "../../scene/globe/globe-scene";
import { CanvasControls } from "../../components/canvas-controls";
import { useTwinStore } from "../../store/twin-store";
import { useStageStore } from "../../store/stage-store";
import { DataStateBadge } from "../../components/data-state-badge";
import { fmt } from "../../i18n/es";

export function RegionPanel() {
  const region = useTwinStore(s => s.region);
  return <aside className="panel"><div className="panel-head"><span className="eyebrow">OBSERVACIÓN DE LA TIERRA</span><h2>Análisis de región</h2><p className="muted">{region?.region_name ?? "Story County, Iowa"}</p></div>
    <section className="card regional-metrics">{region ? [["NDVI",region.ndvi],["Precipitación",region.precipitation],["Temperatura",region.temperature],["Radiación solar",region.radiation]].map(([name, item]) => { if (!item || typeof item === "string") return null; return <div key={String(name)}><small>{String(name)}</small><strong>{item.value === null ? "—" : fmt(item.value,2)} <small>{item.unit === "index" ? "índice" : item.unit}</small></strong><small className="muted" title={item.source ?? undefined}><DataStateBadge state={item.data_state} compact /></small></div>; }) : <p>Cargando indicadores…</p>}</section>
    <section className="card"><h3>Evolución del NDVI</h3>{region?.ndvi_series.length ? <svg viewBox="0 0 400 150" role="img" aria-label="Serie observada de NDVI"><defs><linearGradient id="ndvi-fill" x2="0" y2="1"><stop stopColor="#8cdd72" stopOpacity=".35"/><stop offset="1" stopColor="#8cdd72" stopOpacity="0"/></linearGradient></defs><path d={`M 0 150 ${region.ndvi_series.map((p,i)=>`L ${i*400/Math.max(region.ndvi_series.length-1,1)} ${145-p.value*130}`).join(" ")} L 400 150 Z`} fill="url(#ndvi-fill)"/><polyline points={region.ndvi_series.map((p,i)=>`${i*400/Math.max(region.ndvi_series.length-1,1)},${145-p.value*130}`).join(" ")} fill="none" stroke="#91e679" strokeWidth="2"/></svg> : <p className="muted">Sin observaciones disponibles</p>}<small className="muted">{region?.period_start} — {region?.period_end}</small></section>
    <section className="card"><h3>Compatibilidad de cultivos</h3>{region?.aptitude?.length ? region.aptitude.map(a=><p key={a.crop_id}>{a.crop_id} <strong>{a.index ?? "—"}</strong><small> · Índice comparativo</small></p>) : <p className="muted">No hay un índice verificado disponible para este periodo.</p>}</section><p className="chart-note">El NDVI resume observaciones de la granja; no representa un promedio espacial de toda la región.</p></aside>;
}
export function GlobeScreen() {
 const [zoom,setZoom]=useState({n:0,dir:1}); const [locate,setLocate]=useState(0);
 return <div className="screen"><div className="canvas-area globe-area"><GlobeScene zoomSignal={zoom} locateSignal={locate}/><CanvasControls onZoomIn={()=>setZoom(s=>({n:s.n+1,dir:1}))} onZoomOut={()=>setZoom(s=>({n:s.n+1,dir:-1}))} onLocate={()=>setLocate(s=>s+1)} fullscreenTarget={()=>document.querySelector(".stage-host")}/><button className="explore-cta" onClick={()=>{useStageStore.getState().cancelAutopilot();useStageStore.getState().goTo("map");}}>Explorar la parcela ↗</button></div><RegionPanel/></div>;
}
