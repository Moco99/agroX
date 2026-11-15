import { useEffect, useState, type FormEvent } from "react";
import { DataStateBadge } from "../../components/data-state-badge";
import { es } from "../../i18n/es";
import { getWeatherCoverage, referenceOptions, type WeatherCoverage } from "../../lib/weather-coverage";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";

export function SimulationPeriod() {
  const farmId = useParcelStore((s) => s.farmId);
  const span = useTwinStore((s) => s.span);
  const simulating = useTwinStore((s) => s.simulating);
  const referenceYear = useTwinStore((s) => s.referenceYear);
  const simulateWindow = useTwinStore((s) => s.simulateWindow);
  const synthetic = useTwinStore((s) => s.baseline?.data_mode === "synthetic");
  const [start, setStart] = useState(span.start);
  const [end, setEnd] = useState(span.end);
  const [reference, setReference] = useState(referenceYear?.toString() ?? "");
  const [coverage, setCoverage] = useState<WeatherCoverage | null>(null);
  const [coverageError, setCoverageError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStart(span.start);
    setEnd(span.end);
    setReference(referenceYear?.toString() ?? "");
  }, [span.start, span.end, referenceYear, farmId]);

  useEffect(() => {
    const controller = new AbortController();
    setCoverage(null);
    setCoverageError(false);
    void getWeatherCoverage(farmId, controller.signal).then(setCoverage).catch(() => {
      if (!controller.signal.aborted) setCoverageError(true);
    });
    return () => controller.abort();
  }, [farmId]);

  // Dates beyond the observations need a reference: preselect the most recent complete year
  const latestComplete = coverage?.latest_complete_year ?? null;
  const beyondCoverage = coverage !== null && (start < coverage.start || end > coverage.end);
  useEffect(() => {
    if (beyondCoverage && !reference && latestComplete !== null) setReference(String(latestComplete));
  }, [beyondCoverage, reference, latestComplete]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (beyondCoverage && !reference) {
      setError(latestComplete !== null ? es.weatherReference.requiredWith(latestComplete) : es.weatherReference.required);
      return;
    }
    try {
      await simulateWindow({ start, end }, reference ? Number(reference) : null);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : es.weatherReference.failed);
      }
    }
  }

  return (
    <section className="card simulation-period">
      <h3>{es.weatherReference.title}</h3>
      {coverage ? (
        <p className="muted">{es.weatherReference.coverage(coverage.start, coverage.end, coverage.available_days, coverage.missing.length)}</p>
      ) : (
        <p className="muted">{coverageError ? es.weatherReference.unavailable : es.weatherReference.loading}</p>
      )}
      {coverage && coverage.missing.length > 0 && (
        <details>
          <summary>{es.weatherReference.missingIntervals}</summary>
          <ul>{coverage.missing.map((gap) => <li key={`${gap.start}-${gap.end}`}>{gap.start} — {gap.end}</li>)}</ul>
        </details>
      )}
      {referenceYear !== null && <p className="muted" role="status"><DataStateBadge state={synthetic ? "SYNTHETIC" : "SIMULATED"} compact /> {es.weatherReference.active(referenceYear)}</p>}
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>{es.weatherReference.start}</span>
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>{es.weatherReference.end}</span>
          <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span>{es.weatherReference.year}</span>
          {coverage ? (
            <select value={reference} onChange={(e) => setReference(e.target.value)}>
              <option value="">{es.weatherReference.noReference}</option>
              {/* Keep a year from an earlier run selectable even if it is not in the list */}
              {reference && !referenceOptions(coverage).some((o) => String(o.year) === reference) && <option value={reference}>{reference}</option>}
              {referenceOptions(coverage).map((o) => (
                <option key={o.year} value={o.year}>
                  {o.complete ? es.weatherReference.completeYear(o.year) : es.weatherReference.partialYear(o.year)}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={1900} step={1} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={es.weatherReference.placeholder} />
          )}
        </label>
        {coverage?.complete_years && coverage.complete_years.length > 0 && (
          <p className="muted">
            {es.weatherReference.usableYears(coverage.complete_years[0] ?? 0, coverage.complete_years.at(-1) ?? 0, coverage.max_filled_gap_days ?? 0)}
          </p>
        )}
        <p className="muted">{es.weatherReference.explanation}</p>
        {error && <p role="alert" className="error-box">{error}</p>}
        <button type="submit" className="ghost-button" disabled={simulating}>
          {simulating ? es.weatherReference.loadingSimulation : es.weatherReference.submit}
        </button>
      </form>
    </section>
  );
}
