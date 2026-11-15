import { usePointStore } from "../../store/point-store";
import { es, fmt } from "../../i18n/es";
import { isRecord } from "../../types/guards";
import { POINT_SECTIONS } from "../../services/point-query";
import { insideBounds } from "../../lib/globe-view";
import { useTwinStore } from "../../store/twin-store";

function Fields({
  data,
  depth = 0,
}: {
  data: Record<string, unknown>;
  depth?: number;
}) {
  return (
    <dl className="point-fields">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{es.point.labels[key] ?? key.replaceAll("_", " ")}</dt>
          <dd>
            {isRecord(value) ? (
              depth < 2 ? (
                <Fields data={value} depth={depth + 1} />
              ) : (
                <span>{es.point.records(Object.keys(value).length)}</span>
              )
            ) : Array.isArray(value) ? (
              <span>{es.point.records(value.length)}</span>
            ) : value === null ? (
              es.point.noData
            ) : typeof value === "number" ? (
              fmt(value, 2)
            ) : typeof value === "boolean" ? (
              value ? (
                es.point.yes
              ) : (
                es.point.no
              )
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Vegetation({ data }: { data: Record<string, unknown> }) {
  const series = (Array.isArray(data.serie) ? data.serie : [])
    .filter(isRecord)
    .filter(
      (p) =>
        typeof p.fecha === "string" &&
        typeof p.ndvi === "number" &&
        Number.isFinite(p.ndvi),
    );
  return (
    <>
      {series.length > 0 && (
        <>
          <svg
            className="point-ndvi-chart"
            viewBox="0 0 500 160"
            role="img"
            aria-label={es.point.chart}
          >
            <polyline
              points={series
                .map(
                  (p, i) =>
                    `${10 + (i * 480) / Math.max(series.length - 1, 1)},${145 - (Number(p.ndvi) + 1) * 65}`,
                )
                .join(" ")}
              fill="none"
              stroke="#9eea7f"
              strokeWidth="3"
            />
          </svg>
          <p className="muted">
            {String(series[0]?.fecha)} — {String(series.at(-1)?.fecha)} ·{" "}
            {es.point.observations(series.length)}
          </p>
        </>
      )}
      <Fields
        data={Object.fromEntries(
          Object.entries(data).filter(([key]) => key !== "serie"),
        )}
      />
    </>
  );
}
function Climate({ data }: { data: Record<string, unknown> }) {
  const daily = isRecord(data.diario) ? data.diario : {};
  const units = isRecord(data.unidades) ? data.unidades : {};
  const names = es.point.climateNames;
  return (
    <>
      <dl className="point-fields">
        {Object.entries(daily).map(([key, series]) => {
          const values = isRecord(series)
            ? Object.entries(series)
                .filter(
                  (entry): entry is [string, number] =>
                    typeof entry[1] === "number" && Number.isFinite(entry[1]),
                )
                .sort(([a], [b]) => a.localeCompare(b))
            : [];
          return (
            <div key={key}>
              <dt>{names[key] ?? key}</dt>
              <dd>
                {values.length
                  ? fmt(values.at(-1)?.[1] ?? 0, 2)
                  : es.point.noData}{" "}
                {String(units[key] ?? "")}
                <small className="muted">
                  {" "}
                  · {es.point.latest(values.at(-1)?.[0] ?? "", values.length)}
                </small>
              </dd>
            </div>
          );
        })}
      </dl>
      <Fields
        data={Object.fromEntries(
          Object.entries(data).filter(
            ([key]) =>
              !["diario", "normales_30_anios", "unidades"].includes(key),
          ),
        )}
      />
    </>
  );
}
export function PointScreen() {
  const state = usePointStore();
  const meta = useTwinStore((s) => s.imageryMeta);
  const req = state.request;
  // Honest coverage: the point query works anywhere, parcels/NDVI by date/twin only inside the pilot
  const inPilot = req && meta ? insideBounds(req, meta.bounds) : false;
  return (
    <section className="point-screen" aria-labelledby="point-heading">
      <header className="point-heading">
        <div>
          <span className="eyebrow">{es.point.search}</span>
          <h1 id="point-heading">{es.point.title}</h1>
          <p>
            {req ? `${req.lat.toFixed(5)}, ${req.lon.toFixed(5)} · ${req.start} — ${req.end}` : ""}
          </p>
          <p className="muted">{es.point.hint}</p>
          {req && <p className={inPilot ? "coverage-note is-in" : "coverage-note"}>{inPilot ? es.geo.insidePilot : es.geo.outsidePilot}</p>}
        </div>
        <button type="button" className="ghost-button" onClick={state.close}>
          ← {es.point.pilot} <kbd>Esc</kbd>
        </button>
      </header>
      {state.loading && (
        <div role="status" className="card">
          <p>{es.point.loading}</p>
          <button type="button" className="ghost-button" onClick={state.cancel}>
            {es.point.cancel}
          </button>
        </div>
      )}
      {state.error && (
        <p role="alert" className="error-box">
          {es.point.error}: {state.error}
        </p>
      )}
      {!state.loading && state.request && (
        <button
          className="ghost-button"
          onClick={() => {
            if (state.request)
              void state.query({ ...state.request, refresh: true });
          }}
        >
          {es.point.retry}
        </button>
      )}
      {state.result && (
        <div className="point-grid">
          {POINT_SECTIONS.map((key) => {
            const section = state.result?.sections[key];
            if (!section) return null;
            return (
              <section
                className="card"
                key={key}
                aria-labelledby={`point-${key}`}
              >
                <h2 id={`point-${key}`}>{es.point.sections[key]}</h2>
                <p className="muted">
                  {section.source} ·{" "}
                  {es.point.state[
                    section.data_state as keyof typeof es.point.state
                  ] ?? section.data_state}
                </p>
                {section.status === "error" ? (
                  <div role="alert">
                    <p>{es.point.partial}</p>
                    <details>
                      <summary>{es.point.error}</summary>
                      {section.error}
                    </details>
                  </div>
                ) : section.data ? (
                  key === "vegetation" ? (
                    <Vegetation data={section.data} />
                  ) : key === "climate" ? (
                    <Climate data={section.data} />
                  ) : (
                    <Fields data={section.data} />
                  )
                ) : (
                  <p>{es.point.noData}</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
