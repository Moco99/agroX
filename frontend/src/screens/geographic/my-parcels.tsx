import { useState } from "react";
import { es } from "../../i18n/es";
import { PILOT_FARM_ID } from "../../lib/parcel";
import { displayName, type ParcelRecord } from "../../lib/parcel-history";
import { useHistoryStore } from "../../store/history-store";
import { openFromHistory } from "../../store/open-parcel";
import { useParcelStore } from "../../store/parcel-store";

// ─────────────────────────────────────────
// Section: "Mis parcelas" (history of opened or drawn parcels: reopen, rename, delete)
// ─────────────────────────────────────────

function Row({ rec }: { rec: ParcelRecord }) {
  const active = useParcelStore((s) => s.farmId) === rec.farmId;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pilot = rec.farmId === PILOT_FARM_ID;
  const save = () => {
    useHistoryStore.getState().rename(rec.farmId, name);
    setEditing(false);
  };
  return (
    <li data-testid="parcel-row">
      {editing ? (
        <div className="panel-actions">
          <input aria-label={es.history.nameLabel} value={name} autoFocus maxLength={60}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <button type="button" className="ghost-button" onClick={save}>{es.history.save}</button>
          <button type="button" className="ghost-button" onClick={() => setEditing(false)}>{es.history.cancel}</button>
        </div>
      ) : (
        <>
          <strong>{displayName(rec)}{active ? " ●" : ""}</strong>
          <small className="muted">{es.history.meta(rec.areaHa, rec.zoneCount)}</small>
          <div className="panel-actions">
            <button type="button" className="ghost-button" onClick={() => void openFromHistory(rec).then(setError)}>
              {es.history.open}
            </button>
            <button type="button" className="ghost-button"
              onClick={() => { setName(rec.customName ?? displayName(rec)); setEditing(true); }}>
              {es.history.rename}
            </button>
            {!pilot && (
              <button type="button" className="ghost-button" onClick={() => useHistoryStore.getState().remove(rec.farmId)}>
                {es.history.remove}
              </button>
            )}
          </div>
          {error && <small className="coverage-note is-warn" role="alert">{es.history.openFailed(error)}</small>}
        </>
      )}
    </li>
  );
}

export function MyParcels() {
  const items = useHistoryStore((s) => s.items);
  return (
    <section className="card" data-testid="my-parcels">
      <h3>{es.history.title}</h3>
      <ul className="parcel-list">
        {items.map((rec) => (
          <Row key={rec.farmId} rec={rec} />
        ))}
      </ul>
    </section>
  );
}
