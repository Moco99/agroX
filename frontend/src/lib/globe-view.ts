import type { MapOptions } from "maplibre-gl";
import type { GeoBounds } from "../types/api";

// ─────────────────────────────────────────
// Section: Camera presets (globe overview and the Iowa pilot farm)
// ─────────────────────────────────────────

export type LngLat = [number, number];

export interface CameraView {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

// Pilot farm centroid (Story County, Iowa); the only place with parcels, NDVI by date and a 3D twin
export const PILOT_CENTER: LngLat = [-93.490654, 42.028951];

// Whole Earth framed over the Americas, like mockup 12; zoom 2 fills a laptop viewport like the mockup
export const GLOBE_VIEW: CameraView = { center: [-78, 14], zoom: 2, bearing: 0, pitch: 0 };

// Close enough to read the farm polygon and the four zones over the satellite mosaic
export const PILOT_VIEW: CameraView = { center: PILOT_CENTER, zoom: 14.6, bearing: 0, pitch: 0 };

// Example destinations outside the pilot: imagery only (no parcels, NDVI by date or twin), plus the point query
export interface Place {
  id: "pampa" | "veracruz" | "cdmx";
  view: CameraView;
}

export const EXPLORE_PLACES: readonly Place[] = [
  // Grain fields west of Pergamino, Buenos Aires (Pampa húmeda)
  { id: "pampa", view: { center: [-60.68, -33.97], zoom: 14.4, bearing: 0, pitch: 0 } },
  // Sugar-cane plots near Úrsulo Galván on the Veracruz coastal plain
  { id: "veracruz", view: { center: [-96.358, 19.389], zoom: 14.6, bearing: 0, pitch: 0 } },
  // Mexico City historic centre, to show the same zoom on dense urban fabric
  { id: "cdmx", view: { center: [-99.1332, 19.4326], zoom: 15.5, bearing: 0, pitch: 0 } },
];

// Esri World Imagery tops out at z19 in most farmland; deeper zooms only upscale pixels
export const MAX_ZOOM = 19;

// Cinematic flight duration; within the 4–5 s brief and long enough for tiles to stream in mid-flight
export const FLIGHT_MS = 4600;

// Below this zoom the map stage hands control back to the globe stage (the farm is a dot by then)
export const MAP_EXIT_ZOOM = 9;
// Zooming manually past this level over the pilot farm promotes the view to the farm (map) stage
export const MAP_ENTER_ZOOM = 12.5;

// ─────────────────────────────────────────
// Section: Imagery sources (low zoom NASA GIBS, high zoom Esri, bundled offline fallback)
// ─────────────────────────────────────────

const env = import.meta.env as Record<string, string | undefined>;

// NASA GIBS Blue Marble Next Generation: public domain, no key, cloud-free mosaic; native levels 0–8
export const GIBS_TILE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
export const GIBS_MAX_ZOOM = 8;
export const GIBS_ATTRIBUTION =
  "Imagery: NASA Earth Observatory Blue Marble NG via NASA GIBS (public domain)";

// Esri World Imagery; can be swapped through env for a licensed provider before a public deployment
export const ESRI_TILE_URL =
  env.VITE_SATELLITE_TILE_URL ||
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_ATTRIBUTION =
  env.VITE_SATELLITE_ATTRIBUTION ||
  "Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community";

// Low-zoom mosaic stitched from GIBS level 3 (2048 px, Web Mercator) and shipped with the app for offline use
export const FALLBACK_IMAGE_URL = "/textures/earth/blue-marble-mercator-2k.jpg";
// Web Mercator latitude limit; the stitched fallback covers exactly the square world
const MERCATOR_LAT = 85.051129;

// Crossfade window: GIBS fades out while Esri fades in, so zooming never shows a hard seam
export const CROSSFADE_START = 4.5;
export const CROSSFADE_END = 6.5;

// Source ids are shared with the screen to detect tile failures per provider
export const SOURCE = {
  fallback: "earth-fallback",
  gibs: "gibs-blue-marble",
  esri: "esri-world-imagery",
} as const;

export const NETWORK_SOURCES: readonly string[] = [SOURCE.gibs, SOURCE.esri];

type StyleSpec = Exclude<MapOptions["style"], string | undefined>;

export function buildGlobeStyle(): StyleSpec {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      [SOURCE.fallback]: {
        type: "image",
        url: FALLBACK_IMAGE_URL,
        coordinates: [
          [-180, MERCATOR_LAT],
          [180, MERCATOR_LAT],
          [180, -MERCATOR_LAT],
          [-180, -MERCATOR_LAT],
        ],
      },
      [SOURCE.gibs]: {
        type: "raster",
        tiles: [GIBS_TILE_URL],
        tileSize: 256,
        minzoom: 0,
        maxzoom: GIBS_MAX_ZOOM,
        attribution: GIBS_ATTRIBUTION,
      },
      [SOURCE.esri]: {
        type: "raster",
        tiles: [ESRI_TILE_URL],
        tileSize: 256,
        minzoom: 0,
        maxzoom: MAX_ZOOM,
        attribution: ESRI_ATTRIBUTION,
      },
    },
    layers: [
      // Dark ocean behind everything: the bundled image does not reach the poles beyond 85°
      { id: "space-ocean", type: "background", paint: { "background-color": "#071624" } },
      { id: SOURCE.fallback, type: "raster", source: SOURCE.fallback, paint: { "raster-fade-duration": 0 } },
      {
        id: SOURCE.gibs,
        type: "raster",
        source: SOURCE.gibs,
        // GIBS tiles are only requested where they are visible, i.e. until the crossfade has finished
        maxzoom: CROSSFADE_END + 0.5,
        paint: { "raster-fade-duration": 250 },
      },
      {
        id: SOURCE.esri,
        type: "raster",
        source: SOURCE.esri,
        // Esri is not requested at globe scale, which keeps its traffic to the zooms that need it
        minzoom: CROSSFADE_START,
        paint: {
          "raster-fade-duration": 250,
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], CROSSFADE_START, 0, CROSSFADE_END, 1],
        },
      },
    ],
    // Sun anchored to the viewport, almost behind the camera: the visible hemisphere is always in daylight
    // (a map-anchored sun would leave half of the spinning globe in night shading)
    light: { anchor: "viewport", position: [1.5, 210, 15] },
    // Atmosphere glow around the globe that blends away as the camera approaches the ground
    sky: {
      "sky-color": "#0b2a4a",
      "horizon-color": "#5aa8e6",
      "fog-color": "#a8d4ff",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.8,
      "fog-ground-blend": 0.9,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
    },
  };
}

// ─────────────────────────────────────────
// Section: Geographic helpers (pure; covered by unit tests)
// ─────────────────────────────────────────

// MapLibre reports longitudes outside ±180 after the globe has been spun; the API expects the canonical range
export function normalizeLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  // Keep +180 instead of folding it to −180 so a point on the antimeridian keeps its sign
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

export function insideBounds(point: { lat: number; lon: number }, bounds: GeoBounds): boolean {
  return (
    point.lat >= bounds.south && point.lat <= bounds.north && point.lon >= bounds.west && point.lon <= bounds.east
  );
}

// Great-circle distance in km (haversine); used to decide whether the camera is still "at the farm"
export function distanceKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Beyond this distance the farm is off-screen even at the entry zoom, so the farm stage makes no sense
const PILOT_RADIUS_KM = 25;

export type GeoStage = "globe" | "map";

// Continuous zoom drives the stepper: diving into the pilot farm enters "map", leaving it returns to "globe"
export function stageForCamera(current: GeoStage, camera: { center: LngLat; zoom: number }): GeoStage {
  const nearPilot = distanceKm([normalizeLon(camera.center[0]), camera.center[1]], PILOT_CENTER) <= PILOT_RADIUS_KM;
  if (current === "map") return camera.zoom < MAP_EXIT_ZOOM || !nearPilot ? "globe" : "map";
  return camera.zoom >= MAP_ENTER_ZOOM && nearPilot ? "map" : "globe";
}

// Default point-query window: the last two years ending a week ago (latest reanalysis lag), max span the API allows
export function defaultPointRange(today: Date = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 730);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Human scale of the current zoom (metres per pixel at the given latitude, 256 px tiles)
export function metresPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
