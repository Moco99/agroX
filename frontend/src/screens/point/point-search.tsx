import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { es } from "../../i18n/es";
import { parseCoordinates } from "../../lib/coord-parse";
import { coordinatesView } from "../../lib/coordinates";
import { searchPlaces, type PlaceHit } from "../../services/geocode";
import { useDrawStore } from "../../store/draw-store";
import { useMapStore } from "../../store/map-store";
import { usePointStore } from "../../store/point-store";
import { useStageStore } from "../../store/stage-store";

// Nominatim allows ~1 request/s: wait until the user stops typing, and never search while the text looks numeric
const DEBOUNCE_MS = 900;
const NUMERIC_LIKE = /^[\d\s.,;+\-°'"′″NSEWOnsewo]+$/;

const REASON_TEXT = { format: es.coordHelp.format, "lat-range": es.coordHelp.latRange, "lon-range": es.coordHelp.lonRange } as const;

function flyAndDraw(lat: number, lon: number): void {
  const view = coordinatesView(String(lat), String(lon));
  if (!view) return;
  usePointStore.getState().close();
  if (useStageStore.getState().stage === "twin") useStageStore.getState().goTo("globe", { instant: true });
  useMapStore.getState().flyTo(view);
  useDrawStore.getState().setActive(true);
}

// Coordinate search only flies the map there and turns drawing on; no point card is created
export function PointSearch({ onSubmit }: { onSubmit: () => void }) {
  const [text, setText] = useState("");
  const [places, setPlaces] = useState<PlaceHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const parsed = useMemo(() => parseCoordinates(text), [text]);
  const trimmed = text.trim();
  const isPlaceQuery = !parsed.ok && parsed.reason === "format" && trimmed.length >= 3 && !NUMERIC_LIKE.test(trimmed) && !/^https?:/i.test(trimmed);

  useEffect(() => {
    setPlaces(null);
    setSearching(isPlaceQuery);
    if (!isPlaceQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPlaces(trimmed, controller.signal).then((hits) => {
        if (controller.signal.aborted) return;
        setPlaces(hits);
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, isPlaceQuery]);

  function go(lat: number, lon: number) {
    flyAndDraw(lat, lon);
    onSubmit();
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (parsed.ok) go(parsed.lat, parsed.lon);
    else if (places && places.length > 0) go(places[0]!.lat, places[0]!.lon);
  }

  const error = trimmed !== "" && !parsed.ok && parsed.reason !== "empty" && !isPlaceQuery ? REASON_TEXT[parsed.reason] : null;
  return (
    <form className="point-form" onSubmit={submit}>
      <strong>{es.point.search}</strong>
      <label>
        {es.coordHelp.label}
        <input name="coords" autoFocus type="text" autoComplete="off" value={text}
          placeholder={es.coordHelp.placeholder} aria-invalid={error !== null}
          onChange={(e) => setText(e.target.value)} />
      </label>
      <small className="muted">{es.coordHelp.examples}</small>
      {error && <p role="alert">{error}</p>}
      {searching && <small className="muted" role="status">{es.coordHelp.searching}</small>}
      {places && places.length === 0 && <small className="muted" role="status">{es.coordHelp.noPlaces}</small>}
      {places && places.length > 0 && (
        <ul className="place-hits" aria-label={es.coordHelp.places}>
          {places.map((h) => (
            <li key={`${h.lat},${h.lon},${h.name}`}>
              <button type="button" className="ghost-button" onClick={() => go(h.lat, h.lon)}>{h.name}</button>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>{es.coordHelp.tipTitle}</summary>
        <small className="muted">{es.coordHelp.tipComputer}<br />{es.coordHelp.tipPhone}</small>
      </details>
      <button type="submit" className="play-button" disabled={!parsed.ok && !(places && places.length > 0)}>
        {es.point.locate}
      </button>
    </form>
  );
}
