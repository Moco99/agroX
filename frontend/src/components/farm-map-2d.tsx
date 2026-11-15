import { es } from "../i18n/es";
import { localRing, type Projector } from "../lib/geo";
import { color } from "../styles/tokens";
import type { Farm, NdviOverlay } from "../types/api";

// ─────────────────────────────────────────
// Section: 2D SVG map (WebGL fallback for S3 and base map of S2; no tiles, no network)
// ─────────────────────────────────────────

interface ZoneStyle {
  fill: string;
  label?: string;
}

interface FarmMap2DProps {
  farm: Farm;
  projector: Projector;
  zoneStyles: Record<string, ZoneStyle>;
  selectedZoneId: string | null;
  onSelect: (id: string) => void;
  overlay?: NdviOverlay | null;
  overlayOpacity?: number;
  zoneFillOpacity?: number;
}

const PAD_M = 60;

export function FarmMap2D({
  farm,
  projector,
  zoneStyles,
  selectedZoneId,
  onSelect,
  overlay = null,
  overlayOpacity = 0.9,
  zoneFillOpacity = 0.75,
}: FarmMap2DProps) {
  const e = projector.extent;
  const w = e.maxX - e.minX + PAD_M * 2;
  const h = e.maxY - e.minY + PAD_M * 2;
  // SVG y grows downwards: north (larger local y) must be at the top
  const sx = (x: number) => x - e.minX + PAD_M;
  const sy = (y: number) => e.maxY - y + PAD_M;
  const path = (ring: [number, number][]) =>
    ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ") + " Z";

  let overlayRect: { x: number; y: number; w: number; h: number } | null = null;
  if (overlay) {
    const [x0, y0] = projector.toLocal(overlay.bounds.west, overlay.bounds.north);
    const [x1, y1] = projector.toLocal(overlay.bounds.east, overlay.bounds.south);
    overlayRect = { x: sx(x0), y: sy(y0), w: x1 - x0, h: y0 - y1 };
  }
  const scaleBar = 200;

  return (
    <svg className="farm-map" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img">
      <rect x={0} y={0} width={w} height={h} fill="#26331F" />
      {overlay && overlayRect && (
        <image
          href={`data:image/png;base64,${overlay.png_base64}`}
          x={overlayRect.x}
          y={overlayRect.y}
          width={overlayRect.w}
          height={overlayRect.h}
          opacity={overlayOpacity}
          preserveAspectRatio="none"
          style={{ imageRendering: "pixelated" }}
        />
      )}
      {farm.zones.map((z) => {
        const ring = localRing(z.geometry, projector);
        const style = zoneStyles[z.zone_id];
        const [cx, cy] = projector.toLocal(z.centroid.lon, z.centroid.lat);
        const selected = selectedZoneId === z.zone_id;
        return (
          <g key={z.zone_id} onClick={() => onSelect(z.zone_id)} style={{ cursor: "pointer" }}>
            <path
              d={path(ring)}
              fill={style?.fill ?? "transparent"}
              fillOpacity={zoneFillOpacity}
              stroke={selected ? color.accent.bright : "#0B121B"}
              strokeWidth={selected ? 6 : 3}
            />
            <text x={sx(cx)} y={sy(cy) - 8} className="map-label" textAnchor="middle">
              {z.name}
            </text>
            <text x={sx(cx)} y={sy(cy) + 22} className="map-label map-label-small" textAnchor="middle">
              {(es.crops[z.crop_id] ?? z.crop_id) + " · " + z.area_ha.toFixed(0) + " ha"}
              {style?.label ? ` · ${style.label}` : ""}
            </text>
          </g>
        );
      })}
      <path d={path(localRing(farm.geometry, projector))} fill="none" stroke={color.accent.bright} strokeWidth={4} />
      <g transform={`translate(${w - PAD_M / 2 - scaleBar}, ${h - PAD_M / 2})`}>
        <line x1={0} y1={0} x2={scaleBar} y2={0} stroke="#fff" strokeWidth={4} />
        <text x={scaleBar / 2} y={-10} className="map-label map-label-small" textAnchor="middle">
          {es.twin.scale(scaleBar)}
        </text>
      </g>
      <g transform={`translate(${w - PAD_M / 2}, ${PAD_M})`}>
        <polygon points="0,-28 10,0 -10,0" fill="#fff" />
        <text x={0} y={22} className="map-label map-label-small" textAnchor="middle">
          {es.twin.compass}
        </text>
      </g>
    </svg>
  );
}
