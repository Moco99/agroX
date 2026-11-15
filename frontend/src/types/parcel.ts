// ─────────────────────────────────────────
// Section: Types for the "open any parcel" flow
// ─────────────────────────────────────────

export interface LatLon {
  lat: number;
  lon: number;
}

// Subset of GET /api/crops used by the declaration form (the catalog has many more physiological fields)
export interface CropParams {
  crop_id: string;
  name_es: string;
  name_en: string;
  cycle_days: number;
  crop_type: string;
  verified?: boolean;
  planting_window: { start_mmdd: string; end_mmdd: string };
}

export interface CropCatalogLite {
  catalog_version: string;
  crops: CropParams[];
  notes: string[];
}
