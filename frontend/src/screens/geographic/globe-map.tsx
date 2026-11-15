import { useEffect, useRef, useState } from "react";
import {
  FullscreenControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type ImageSource,
} from "maplibre-gl";
// The v6 worker is a self-contained module; Vite's dependency pre-bundling breaks MapLibre's own relative
// lookup ("Worker failed to load"), so its URL is resolved by Vite and handed over explicitly
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { es } from "../../i18n/es";
import {
  buildGlobeStyle,
  FLIGHT_MS,
  MAX_ZOOM,
  NETWORK_SOURCES,
  normalizeLon,
  PILOT_CENTER,
  stageForCamera,
  type CameraView,
} from "../../lib/globe-view";
import { api } from "../../services/api";
import { useMapStore } from "../../store/map-store";
import { useStageStore } from "../../store/stage-store";
import { FARM_ID, useTwinStore } from "../../store/twin-store";
import type { GeoBounds } from "../../types/api";

setWorkerUrl(workerUrl);

declare global {
  interface Window {
    // Dev-only handle for Playwright checks (camera, sources); never set in production builds
    __AGROX_MAP__?: MapLibreMap | null;
  }
}

// ─────────────────────────────────────────
// Section: Tunables
// ─────────────────────────────────────────

// Bounded tile cache: a long zoom session around the world must not grow GPU/heap memory without limit
const TILE_CACHE = 320;
// Idle spin of the globe in degrees of longitude per second
const SPIN_DEG_PER_S = 2;
// Spin only while the whole disc is visible; closer in it would feel like the map is drifting
const SPIN_MAX_ZOOM = 3;
// Consecutive failed network tiles (with no success in between) before declaring the imagery offline
const OFFLINE_AFTER_ERRORS = 4;
// Farm overlays appear once the farm covers a few pixels; below that they would only add clutter
const PILOT_MIN_ZOOM = 10;

export interface MapStatus {
  zoom: number;
  lat: number;
  ready: boolean;
  offline: boolean;
}

function cameraOf(map: MapLibreMap): CameraView {
  const c = map.getCenter();
  return { center: [normalizeLon(c.lng), c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function boundsCoordinates(b: GeoBounds): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
}

function errorSourceId(event: unknown): string | null {
  return typeof event === "object" && event !== null && "sourceId" in event && typeof event.sourceId === "string"
    ? event.sourceId
    : null;
}

// Built with DOM APIs (no innerHTML) so the label text can never be interpreted as markup
function pilotPinElement(): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pilot-pin";
  el.title = es.geo.pilot;
  el.setAttribute("aria-label", es.geo.pilot);
  const dot = document.createElement("span");
  dot.className = "pilot-pin-dot";
  const label = document.createElement("span");
  label.className = "pilot-pin-label";
  label.textContent = es.geo.pinLabel;
  el.append(dot, label);
  return el;
}

// ─────────────────────────────────────────
// Section: Globe map (MapLibre globe projection with continuous zoom down to individual fields)
// ─────────────────────────────────────────

export function GlobeMap({ onStatus }: { onStatus: (s: MapStatus) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The map instance once its style has loaded; tied to the instance so a remount (HMR, retry) never sees
  // a stale "loaded" flag from the previous map
  const [ready, setReady] = useState<MapLibreMap | null>(null);
  const [offline, setOffline] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [retry, setRetry] = useState(0);
  const stage = useStageStore((s) => s.stage);
  const reducedMotion = useStageStore((s) => s.reducedMotion);
  const selected = useMapStore((s) => s.selected);
  const flight = useMapStore((s) => s.flight);
  const interacted = useMapStore((s) => s.interacted);
  const farm = useTwinStore((s) => s.farm)?.farm;
  const meta = useTwinStore((s) => s.imageryMeta);
  const ndviDate = useTwinStore((s) => s.ndviDate);
  const layers = useTwinStore((s) => s.mapLayers);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  // ── Map lifecycle: one instance per mount, removed (with its workers and tiles) on unmount ──
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let offlineNow = typeof navigator !== "undefined" && navigator.onLine === false;
    setReady(null);
    setOffline(offlineNow);
    let map: MapLibreMap;
    try {
      const camera = useMapStore.getState().camera;
      map = new MapLibreMap({
        container: el,
        style: buildGlobeStyle(),
        center: camera.center,
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
        minZoom: 0.6,
        maxZoom: MAX_ZOOM,
        maxTileCacheSize: TILE_CACHE,
        attributionControl: { compact: false },
      });
    } catch {
      setWebgl(false);
      return;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) window.__AGROX_MAP__ = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-left");
    map.addControl(new FullscreenControl(), "top-left");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    const report = () => {
      statusRef.current({ zoom: map.getZoom(), lat: map.getCenter().lat, ready: true, offline: offlineNow });
    };
    const setOfflineBoth = (v: boolean) => {
      if (offlineNow === v) return;
      offlineNow = v;
      setOffline(v);
      report();
    };

    map.on("load", () => {
      setReady(map);
      report();
    });
    map.on("zoomend", report);
    // Live zoom readout during flights and wheel zooms, throttled to visible changes (0.1 zoom steps)
    let lastZoom = -1;
    map.on("zoom", () => {
      const z = Math.round(map.getZoom() * 10);
      if (z === lastZoom) return;
      lastZoom = z;
      report();
    });

    // Programmatic spin frames carry { spin: true } and must not be treated as the user settling the camera
    map.on("moveend", (e) => {
      if ("spin" in e) return;
      const camera = cameraOf(map);
      useMapStore.getState().setCamera(camera);
      report();
      const st = useStageStore.getState();
      if (st.stage === "twin") return;
      // A flight lands wherever the camera ended (also when the user interrupted it): only the pilot is "map"
      if (st.phase === "flying") st.endFlight(stageForCamera("globe", camera));
      else st.setGeoStage(stageForCamera(st.stage, camera));
    });

    // Any direct manipulation stops the idle spin for good
    const touched = () => useMapStore.getState().markInteracted();
    map.on("mousedown", touched);
    map.on("touchstart", touched);
    map.on("wheel", touched);

    map.on("click", (e) => {
      useMapStore.getState().select({ lat: e.lngLat.lat, lon: normalizeLon(e.lngLat.lng) });
    });

    // ── Network health: failed GIBS/Esri tiles flip the offline banner; one good tile clears it ──
    let errors = 0;
    map.on("error", (event) => {
      const id = errorSourceId(event);
      if (!id || !NETWORK_SOURCES.includes(id)) return;
      errors += 1;
      if (errors >= OFFLINE_AFTER_ERRORS) setOfflineBoth(true);
    });
    map.on("sourcedata", (event) => {
      if (!NETWORK_SOURCES.includes(event.sourceId) || !event.tile) return;
      errors = 0;
      setOfflineBoth(false);
    });
    const goOffline = () => setOfflineBoth(true);
    const goOnline = () => {
      errors = 0;
      // Re-request the tiles that failed while the connection was down
      for (const id of NETWORK_SOURCES) map.refreshTiles(id);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(el);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      resize.disconnect();
      setReady(null);
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV) window.__AGROX_MAP__ = null;
    };
  }, [retry]);

  // ── Idle spin until the first interaction (skipped with prefers-reduced-motion) ──
  useEffect(() => {
    const map = ready;
    if (!map || stage !== "globe" || interacted || reducedMotion) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!map.isMoving() && map.getZoom() <= SPIN_MAX_ZOOM) {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng - SPIN_DEG_PER_S * dt, c.lat] }, { spin: true });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, stage, interacted, reducedMotion]);

  // ── Requested flights (pilot, globe, example places); reduced motion jumps instead of flying ──
  useEffect(() => {
    const map = ready;
    if (!map || !flight) return;
    useMapStore.getState().consumeFlight(flight.id);
    const { center, zoom, bearing, pitch } = flight.view;
    if (reducedMotion) {
      map.jumpTo({ center, zoom, bearing, pitch });
      const st = useStageStore.getState();
      if (st.phase === "flying") st.endFlight(stageForCamera("globe", cameraOf(map)));
      return;
    }
    // curve > default zooms out further mid-flight, so a long hop reads as leaving and re-entering the Earth
    map.flyTo({ center, zoom, bearing, pitch, duration: FLIGHT_MS, curve: 1.6, essential: true });
    // Safety net: a zero-length flight may not emit moveend, which would leave the stage stuck in "flying"
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      const st = useStageStore.getState();
      if (st.phase === "flying" && mapRef.current) st.endFlight(stageForCamera("globe", cameraOf(mapRef.current)));
    }, FLIGHT_MS + 1500);
  }, [flight, ready, reducedMotion]);

  useEffect(
    () => () => {
      if (watchdog.current) clearTimeout(watchdog.current);
    },
    [],
  );

  // ── Selected point marker ──
  useEffect(() => {
    const map = ready;
    if (!map || !selected) return;
    const marker = new Marker({ color: "#a4ed75" }).setLngLat([selected.lon, selected.lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [selected, ready]);

  // ── Pilot pin at globe scale: the "you can dive here" hint; click starts the cinematic flight ──
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const el = pilotPinElement();
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      useMapStore.getState().flyTo("pilot");
    };
    el.addEventListener("click", onClick);
    const marker = new Marker({ element: el }).setLngLat(PILOT_CENTER).addTo(map);
    // The pin hands over to the drawn polygons once they become visible
    const sync = () => {
      el.style.display = map.getZoom() < PILOT_MIN_ZOOM ? "" : "none";
    };
    sync();
    map.on("zoom", sync);
    return () => {
      map.off("zoom", sync);
      el.removeEventListener("click", onClick);
      marker.remove();
    };
  }, [ready]);

  // ── Farm polygon + zones (GeoJSON from the farm endpoint) ──
  useEffect(() => {
    const map = ready;
    if (!map || !farm) return;
    const data = {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, properties: { kind: "farm", name: farm.name }, geometry: farm.geometry },
        ...farm.zones.map((z) => ({
          type: "Feature" as const,
          properties: { kind: "zone", name: z.name },
          geometry: z.geometry,
        })),
      ],
    };
    const source = map.getSource<GeoJSONSource>("pilot-farm");
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource("pilot-farm", { type: "geojson", data });
    map.addLayer({
      id: "pilot-zones-line",
      type: "line",
      source: "pilot-farm",
      minzoom: PILOT_MIN_ZOOM,
      filter: ["==", ["get", "kind"], "zone"],
      paint: { "line-color": "#f2ffe9", "line-width": 1.2, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
    });
    map.addLayer({
      id: "pilot-farm-line",
      type: "line",
      source: "pilot-farm",
      minzoom: PILOT_MIN_ZOOM,
      filter: ["==", ["get", "kind"], "farm"],
      paint: { "line-color": "#9dff6a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 3.5] },
    });
  }, [ready, farm]);

  // ── NAIP orthophoto from the backend: the pilot still shows real imagery when the tile services are offline ──
  useEffect(() => {
    const map = ready;
    if (!map || !meta) return;
    if (!map.getSource("pilot-naip")) {
      map.addSource("pilot-naip", { type: "image", url: api.basemapUrl(FARM_ID), coordinates: boundsCoordinates(meta.bounds) });
      map.addLayer(
        { id: "pilot-naip", type: "raster", source: "pilot-naip", minzoom: PILOT_MIN_ZOOM - 1, layout: { visibility: "none" } },
        map.getLayer("pilot-ndvi") ? "pilot-ndvi" : map.getLayer("pilot-zones-line") ? "pilot-zones-line" : undefined,
      );
    }
    map.setLayoutProperty("pilot-naip", "visibility", offline ? "visible" : "none");
  }, [ready, meta, offline]);

  // ── NDVI raster for the selected Sentinel-2 date (served by /api/imagery/ndvi) ──
  useEffect(() => {
    const map = ready;
    if (!map || !meta || !ndviDate) return;
    const coordinates = boundsCoordinates(meta.bounds);
    const url = api.ndviImageUrl(FARM_ID, ndviDate);
    const src = map.getSource<ImageSource>("pilot-ndvi");
    if (src) {
      src.updateImage({ url, coordinates });
      return;
    }
    map.addSource("pilot-ndvi", { type: "image", url, coordinates });
    map.addLayer(
      {
        id: "pilot-ndvi",
        type: "raster",
        source: "pilot-ndvi",
        minzoom: PILOT_MIN_ZOOM,
        paint: { "raster-opacity": 0.72, "raster-fade-duration": 0 },
      },
      map.getLayer("pilot-zones-line") ? "pilot-zones-line" : undefined,
    );
  }, [ready, meta, ndviDate]);

  // ── Layer toggles (bottom bar / imagery switch) ──
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    if (map.getLayer("pilot-ndvi")) map.setLayoutProperty("pilot-ndvi", "visibility", vis(layers.ndvi));
    for (const id of ["pilot-zones-line", "pilot-farm-line"])
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(layers.boundaries));
  }, [ready, layers, farm, meta, ndviDate]);

  return (
    <>
      <div className="geographic-map" ref={container} data-testid="globe-map" />
      {!webgl && (
        <div className="map-feedback" role="alert">
          <p>{es.geo.unavailable}</p>
        </div>
      )}
      {webgl && !ready && (
        <p className="map-feedback" role="status">
          {es.geo.loading}
        </p>
      )}
      {offline && (
        <div className="map-feedback is-offline" role="alert">
          <strong>{es.geo.offlineTitle}</strong>
          <p>{es.geo.offlineBody}</p>
          <button type="button" className="ghost-button" onClick={() => setRetry((n) => n + 1)}>
            {es.geo.retry}
          </button>
        </div>
      )}
    </>
  );
}
