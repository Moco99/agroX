import { useState } from "react";
import type { FormEvent } from "react";
import { es } from "../../i18n/es";
import { coordinatesView } from "../../lib/coordinates";
import { useDrawStore } from "../../store/draw-store";
import { useMapStore } from "../../store/map-store";
import { usePointStore } from "../../store/point-store";
import { useStageStore } from "../../store/stage-store";

// Coordinate search only flies the map there and turns drawing on; no point card is created
export function PointSearch({ onSubmit }: { onSubmit: () => void }) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [error, setError] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const view = coordinatesView(lat, lon);
    if (!view) {
      setError(true);
      return;
    }
    setError(false);
    usePointStore.getState().close();
    if (useStageStore.getState().stage === "twin") useStageStore.getState().goTo("globe", { instant: true });
    useMapStore.getState().flyTo(view);
    useDrawStore.getState().setActive(true);
    onSubmit();
  }
  return (
    <form className="point-form" onSubmit={submit}>
      <strong>{es.point.search}</strong>
      <div className="point-form-fields">
        <label>
          {es.point.lat}
          <input name="lat" autoFocus type="number" min="-90" max="90" step="any" required value={lat}
            onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          {es.point.lon}
          <input name="lon" type="number" min="-180" max="180" step="any" required value={lon}
            onChange={(e) => setLon(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert">{es.point.validation}</p>}
      <button type="submit" className="play-button">{es.point.locate}</button>
    </form>
  );
}
