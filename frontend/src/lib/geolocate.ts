// ─────────────────────────────────────────
// Section: Browser geolocation as a promise
// ─────────────────────────────────────────

export type LocateError = "unsupported" | "denied" | "timeout" | "unavailable";

// Not high accuracy on purpose: on desktop Chrome/macOS the GPS-grade request often fails or times out even after
// permission is granted, and a Wi-Fi/IP fix is plenty to start tracing a parcel. The timeout is generous because
// some browsers also count the time spent on the permission prompt.
export function locateMe(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject("unsupported" satisfies LocateError);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        reject((err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable") satisfies LocateError),
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 },
    );
  });
}
