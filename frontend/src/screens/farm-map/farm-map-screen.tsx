import { useState } from "react";
import { useTwinStore, FARM_ID } from "../../store/twin-store";
import { useStageStore } from "../../store/stage-store";
import { api } from "../../services/api";
import { RegionPanel } from "../globe/globe-screen";
import { CanvasControls } from "../../components/canvas-controls";

export function FarmMapScreen() {
  const farm = useTwinStore((s) => s.farm)?.farm;
  const meta = useTwinStore((s) => s.imageryMeta);
  const date = useTwinStore((s) => s.ndviDate);
  const layers = useTwinStore((s) => s.mapLayers);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  if (!farm) return null;
  const bounds = meta?.bounds;
  const point = (p: number[]) =>
    bounds
      ? `${(((p[0] ?? 0) - bounds.west) / (bounds.east - bounds.west)) * 1000},${((bounds.north - (p[1] ?? 0)) / (bounds.north - bounds.south)) * 1000}`
      : "0,0";
  return (
    <div className="screen">
      <div className="canvas-area satellite-area">
        <div className="journey-step">
          ✓ Ubicación <span>→</span> ② Parcela <span>→</span> Análisis
        </div>
        <div className="satellite-viewport">
          <div
            className="satellite-images"
            style={{ transform: `scale(${zoom})` }}
          >
            {!failed && (
              <img
                src={api.basemapUrl(FARM_ID)}
                onError={() => setFailed(true)}
                alt="Ortofoto de la parcela"
              />
            )}
            {failed && (
              <p className="map-unavailable">
                Ortofoto no disponible. Revisa la conexión de datos.
              </p>
            )}
            {layers.ndvi && date && (
              <img
                className="ndvi-raster"
                src={api.ndviImageUrl(FARM_ID, date)}
                alt={`NDVI observado el ${date}`}
              />
            )}
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {bounds &&
                layers.boundaries &&
                farm.zones.map((z) => (
                  <polygon
                    key={z.zone_id}
                    points={(z.geometry.coordinates[0] ?? [])
                      .map(point)
                      .join(" ")}
                    fill="transparent"
                    stroke="#baff91"
                    strokeWidth="2"
                    onClick={() =>
                      useTwinStore.getState().selectZone(z.zone_id)
                    }
                  >
                    <title>{z.name}</title>
                  </polygon>
                ))}
            </svg>
          </div>
        </div>
        <CanvasControls
          onZoomIn={() => setZoom((z) => Math.min(3, z + 0.25))}
          onZoomOut={() => setZoom((z) => Math.max(1, z - 0.25))}
          onLocate={() => setZoom(1)}
          fullscreenTarget={() => document.querySelector(".stage-host")}
        />
        <div className="map-caption">
          <strong>{farm.name}</strong>
          <span>
            {farm.area_ha.toFixed(1)} ha · {date ?? "Sin fecha NDVI"}
          </span>
        </div>
        <button
          className="explore-cta"
          onClick={() => {
            useStageStore.getState().cancelAutopilot();
            useStageStore.getState().goTo("twin");
          }}
        >
          Entrar al gemelo 3D ↗
        </button>
      </div>
      <RegionPanel />
    </div>
  );
}
