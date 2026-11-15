import { ESRI_TILE_URL } from "./globe-view";
import type { GeoBounds } from "../types/api";

// ─────────────────────────────────────────
// Section: Esri World Imagery stitched into one texture for a lon/lat box (the same tiles the 2D map uses)
// ─────────────────────────────────────────

const TILE_PX = 256;
const MAX_TILES = 36;
const MAX_ZOOM = 18;

// Fractional Web Mercator tile coordinates of a lon/lat at zoom z
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

// Highest zoom whose tile cover of the box stays under MAX_TILES (keeps the request count polite)
export function pickZoom(b: GeoBounds): number {
  for (let z = MAX_ZOOM; z > 3; z -= 1) {
    const [x0, y0] = tileXY(b.west, b.north, z);
    const [x1, y1] = tileXY(b.east, b.south, z);
    if ((Math.floor(x1) - Math.floor(x0) + 1) * (Math.floor(y1) - Math.floor(y0) + 1) <= MAX_TILES) return z;
  }
  return 3;
}

export const esriTileUrl = (z: number, x: number, y: number) =>
  ESRI_TILE_URL.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("tile failed"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    img.src = src;
  });
}

// Resolves to a canvas cropped exactly to the box; rejects if any tile fails so the caller can fall back
export async function fetchEsriCanvas(b: GeoBounds, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const z = pickZoom(b);
  const [fx0, fy0] = tileXY(b.west, b.north, z);
  const [fx1, fy1] = tileXY(b.east, b.south, z);
  const tx0 = Math.floor(fx0);
  const ty0 = Math.floor(fy0);
  const cols = Math.floor(fx1) - tx0 + 1;
  const rows = Math.floor(fy1) - ty0 + 1;
  const full = document.createElement("canvas");
  full.width = cols * TILE_PX;
  full.height = rows * TILE_PX;
  const ctx = full.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const jobs: Promise<void>[] = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1)
      jobs.push(loadImage(esriTileUrl(z, tx0 + c, ty0 + r), signal).then((img) => ctx.drawImage(img, c * TILE_PX, r * TILE_PX)));
  await Promise.all(jobs);
  const sx = (fx0 - tx0) * TILE_PX;
  const sy = (fy0 - ty0) * TILE_PX;
  const sw = Math.max(1, (fx1 - fx0) * TILE_PX);
  const sh = Math.max(1, (fy1 - fy0) * TILE_PX);
  const out = document.createElement("canvas");
  out.width = Math.round(sw);
  out.height = Math.round(sh);
  out.getContext("2d")?.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}
