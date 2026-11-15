import { useEffect, useMemo, useState } from "react";
import { DataStateBadge } from "../../components/data-state-badge";
import { es, fmtDate } from "../../i18n/es";
import { EMPTY_DECLARATION, isPilotFarm, latestUsablePlanting, suggestPlantingDate, type Declaration } from "../../lib/parcel";
import { useParcelStore } from "../../store/parcel-store";
import { useTwinStore } from "../../store/twin-store";

// ─────────────────────────────────────────
// Section: Declare crop and planting date (DECLARED; outside the US nobody else knows what is planted)
// ─────────────────────────────────────────

export function DeclarationPanel() {
  const farmId = useParcelStore((s) => s.farmId);
  const declaration = useParcelStore((s) => s.declaration);
  const catalog = useParcelStore((s) => s.catalog);
  const setDeclaration = useParcelStore((s) => s.setDeclaration);
  const farm = useTwinStore((s) => s.farm)?.farm;
  const plan = useTwinStore((s) => s.plan);
  const coverageEnd = useTwinStore((s) => s.health?.weather_coverage.end);
  const simulating = useTwinStore((s) => s.simulating);
  const apply = useTwinStore((s) => s.applyDeclaration);
  const error = useTwinStore((s) => s.error);
  const backendNote = useTwinStore((s) => s.farm)?.declared_inputs?.unsupported_crop_note;
  // Draft edits stay local until "Aplicar y simular": each change re-runs a simulation otherwise
  const [draft, setDraft] = useState<Declaration>(declaration);
  useEffect(() => setDraft(declaration), [declaration, farmId]);

  const zones = farm?.zones ?? [];
  const crops = catalog?.crops ?? [];
  const cropName = (id: string) => crops.find((c) => c.crop_id === id)?.name_es ?? es.crops[id] ?? id;
  const zoneCrop = (zoneId: string, farmCrop: string) => draft.crops[zoneId] ?? farmCrop;
  const usedCrops = useMemo(
    () => [...new Set(zones.map((z) => draft.crops[z.zone_id] ?? z.crop_id))],
    [zones, draft.crops],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(declaration);

  if (isPilotFarm(farmId)) {
    return (
      <section className="card">
        <h3>{es.openParcel.declTitle}</h3>
        <p className="muted">{es.openParcel.declPilot}</p>
      </section>
    );
  }
  if (!farm) return null;

  const lat = farm.centroid.lat;
  const suggestion = (cropId: string): string | null => {
    const params = crops.find((c) => c.crop_id === cropId);
    if (!params || !coverageEnd) return null;
    return latestUsablePlanting((y) => suggestPlantingDate(params, lat, y), params.cycle_days, coverageEnd);
  };
  const setAll = (cropId: string) =>
    setDraft((d) => ({ ...d, crops: Object.fromEntries(zones.map((z) => [z.zone_id, cropId])) }));

  return (
    <section className="card declaration-card" data-testid="declaration">
      <div className="card-head">
        <h3>{es.openParcel.declTitle}</h3>
        <DataStateBadge state="DECLARED" compact />
      </div>
      <p className="muted">{es.openParcel.declHint}</p>
      {backendNote && <small className="muted">{backendNote}</small>}
      {crops.length > 0 && <small className="muted">{es.openParcel.declCatalogNote(crops.map((c) => c.name_es).join(", "))}</small>}
      <label className="field">
        <span>{es.openParcel.declAll}</span>
        <select value="" onChange={(e) => e.target.value && setAll(e.target.value)} aria-label={es.openParcel.declAll}>
          <option value="">—</option>
          {crops.map((c) => (
            <option key={c.crop_id} value={c.crop_id}>
              {c.name_es}
            </option>
          ))}
        </select>
      </label>
      {zones.map((z) => (
        <label className="field" key={z.zone_id}>
          <span>
            {es.openParcel.declZone}: <strong>{z.name}</strong>
          </span>
          <select
            value={zoneCrop(z.zone_id, z.crop_id)}
            onChange={(e) =>
              setDraft((d) => ({ ...d, crops: { ...d.crops, [z.zone_id]: e.target.value } }))
            }
          >
            {crops.map((c) => (
              <option key={c.crop_id} value={c.crop_id}>
                {c.name_es}
              </option>
            ))}
          </select>
        </label>
      ))}
      {usedCrops.map((cropId) => {
        const sug = suggestion(cropId);
        const declared = draft.planting[cropId];
        const value = declared ?? plan?.plantingDates[cropId] ?? sug ?? "";
        return (
          <div className="field" key={cropId}>
            <span>
              {es.openParcel.declPlanting(cropName(cropId))}{" "}
              <DataStateBadge state={declared ? "DECLARED" : "ESTIMATED"} compact />
            </span>
            <input
              type="date"
              value={value}
              onChange={(e) =>
                setDraft((d) => {
                  const planting = { ...d.planting };
                  if (e.target.value) planting[cropId] = e.target.value;
                  else delete planting[cropId];
                  return { ...d, planting };
                })
              }
            />
            {sug && (
              <small className="muted">
                {es.openParcel.declSuggested(fmtDate(sug))}{" "}
                {declared !== sug && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setDraft((d) => ({ ...d, planting: { ...d.planting, [cropId]: sug } }))}
                  >
                    {es.openParcel.declUseSuggestion}
                  </button>
                )}
              </small>
            )}
            {crops.find((c) => c.crop_id === cropId)?.verified === false && (
              <small className="muted">{es.openParcel.declUnverified}</small>
            )}
          </div>
        );
      })}
      {error && (
        <p className="load-error" role="alert">
          {error}
        </p>
      )}
      <div className="panel-actions">
        <button
          type="button"
          className="play-button wide-button"
          disabled={!dirty || simulating}
          onClick={() => {
            setDeclaration(draft);
            void apply();
          }}
        >
          {simulating ? es.openParcel.declApplying : es.openParcel.declApply}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={simulating}
          onClick={() => {
            setDraft(EMPTY_DECLARATION);
            setDeclaration(EMPTY_DECLARATION);
            void apply();
          }}
        >
          {es.openParcel.declReset}
        </button>
      </div>
    </section>
  );
}
