import { useState } from "react";
import type { FormEvent } from "react";
import { usePointStore } from "../../store/point-store";
import { es } from "../../i18n/es";
import { defaultPointRange } from "../../lib/globe-view";
import { useMapStore } from "../../store/map-store";
export function PointSearch({ onSubmit }: { onSubmit: () => void }) {
  const range = defaultPointRange();
  // Prefill with the point picked on the map so ⌘K → Enter queries what the user is looking at
  const picked = useMapStore.getState().selected;
  const [lat, setLat] = useState(picked ? picked.lat.toFixed(6) : "");
  const [lon, setLon] = useState(picked ? picked.lon.toFixed(6) : "");
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const [error, setError] = useState(false);
  const query = usePointStore((s) => s.query);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      start > end ||
      (Date.parse(end) - Date.parse(start)) / 86400000 > 730 ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lon)) ||
      Math.abs(Number(lat)) > 90 ||
      Math.abs(Number(lon)) > 180
    ) {
      setError(true);
      return;
    }
    setError(false);
    // The marker shows where the query was made when the overlay is closed again
    useMapStore.getState().select({ lat: Number(lat), lon: Number(lon) });
    void query({ lat: Number(lat), lon: Number(lon), start, end });
    onSubmit();
  }
  return (
    <form className="point-form" onSubmit={submit}>
      <strong>{es.point.search}</strong>
      <p>{es.point.hint}</p>
      <div className="point-form-fields">
        <label>
          {es.point.lat}
          <input
            name="lat"
            autoFocus
            type="number"
            min="-90"
            max="90"
            step="any"
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </label>
        <label>
          {es.point.lon}
          <input
            name="lon"
            type="number"
            min="-180"
            max="180"
            step="any"
            required
            value={lon}
            onChange={(e) => setLon(e.target.value)}
          />
        </label>
        <label>
          {es.point.start}
          <input
            type="date"
            required
            max={end}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {es.point.end}
          <input
            type="date"
            required
            min={start}
            max={range.end}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{es.point.validation}</p>}
      <button type="submit" className="play-button">
        {es.point.submit}
      </button>
    </form>
  );
}
