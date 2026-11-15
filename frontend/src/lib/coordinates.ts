import type { CameraView } from "./globe-view";

// At polar latitudes retain the globe projection; high zoom uses the Mercator tile grid.
export function coordinatesView(latText: string, lonText: string): CameraView | null {
  if (!latText.trim() || !lonText.trim()) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { center: [lon, lat], zoom: Math.abs(lat) > 85 ? 2 : 14, bearing: 0, pitch: 0 };
}

// Point API rounds coordinates to five decimal places; nearby fields must never share a coverage result.
export function sameQueriedPoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lon.toFixed(5) === b.lon.toFixed(5);
}
