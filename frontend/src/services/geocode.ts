// ─────────────────────────────────────────
// Section: Place-name search (Nominatim / OpenStreetMap; public instance, ~1 request/s, no key)
// ─────────────────────────────────────────

export interface PlaceHit {
  name: string;
  lat: number;
  lon: number;
}

// Returns [] on any failure so the coordinate form keeps working when the geocoder is down or blocked
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const hits: PlaceHit[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const { display_name, lat, lon } = item as Record<string, unknown>;
      const la = Number(lat);
      const lo = Number(lon);
      if (typeof display_name === "string" && Number.isFinite(la) && Number.isFinite(lo)) hits.push({ name: display_name, lat: la, lon: lo });
    }
    return hits;
  } catch {
    return [];
  }
}
