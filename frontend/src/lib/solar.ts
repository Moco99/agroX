// ─────────────────────────────────────────
// Section: Solar geometry (NOAA low-precision formulas; lighting only, never agronomy)
// ─────────────────────────────────────────

// Accuracy of ~1° is plenty for placing the sun in a 3D scene; the ET0 of the twin comes from the backend.

const DEG = Math.PI / 180;

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

// Solar declination (degrees) and equation of time (minutes) for a UTC date
function declinationAndEot(date: Date): { declination: number; eot: number } {
  const n = dayOfYear(date);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const gamma = ((2 * Math.PI) / 365) * (n - 1 + (hours - 12) / 24);
  const eot =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination =
    (0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma)) /
    DEG;
  return { declination, eot };
}

export function parseIsoDate(iso: string, utcHour = 12): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2024, (m ?? 7) - 1, d ?? 15, utcHour));
}

// Point on Earth where the sun is at the zenith for a UTC instant (drives the globe's day/night terminator)
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const { declination, eot } = declinationAndEot(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lon = -15 * (utcHours - 12 + eot / 60);
  return { lat: declination, lon: ((lon + 540) % 360) - 180 };
}

export interface SunAngles {
  // Degrees above the horizon (negative = below)
  elevation: number;
  // Degrees clockwise from north
  azimuth: number;
}

// Sun elevation/azimuth at a site for a local clock hour (standard time offset in hours, e.g. -5 for CDT)
export function sunAngles(lat: number, lon: number, iso: string, localHour: number, utcOffsetHours: number): SunAngles {
  const date = parseIsoDate(iso, Math.round(localHour - utcOffsetHours));
  const { declination, eot } = declinationAndEot(date);
  const solarTime = localHour + eot / 60 + (lon - utcOffsetHours * 15) / 15;
  const hourAngle = 15 * (solarTime - 12);
  const latR = lat * DEG;
  const decR = declination * DEG;
  const haR = hourAngle * DEG;
  const sinEl = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosAz = (Math.sin(decR) - Math.sin(elevation) * Math.sin(latR)) / (Math.cos(elevation) * Math.cos(latR) + 1e-9);
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG;
  if (hourAngle > 0) azimuth = 360 - azimuth;
  return { elevation: elevation / DEG, azimuth };
}

// Unit direction vector towards the sun in a scene where +x = east, +y = up, -z = north
export function sunDirection(a: SunAngles): [number, number, number] {
  const el = a.elevation * DEG;
  const az = a.azimuth * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

// Position of a lat/lon on a unit sphere whose equirectangular texture follows THREE.SphereGeometry UVs
export function latLonToVector(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}
