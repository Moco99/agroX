/* ═════════════════════════════════════════════════════════════════════════
   AGROX // MAPLIBRE GLOBE & TACTICAL ORBITAL VISOR
   ═════════════════════════════════════════════════════════════════════════ */

const terrainLocations = {
  mexico: [-101.25, 20.63],
  argentina: [-61.55, -31.45],
  iowa: [-93.69, 42.026],
  veracruz: [-96.35, 19.12]
};

// Puntos de calor / Vigor activo en el globo (Foto 3)
const activeHotspots = [
  { id: 'mexico', name: 'Bajío de México', coords: [-101.25, 20.63], color: 'green' },
  { id: 'argentina', name: 'Pampa Húmeda, Argentina', coords: [-61.55, -31.45], color: 'green' },
  { id: 'iowa', name: 'Iowa Corn Belt, USA', coords: [-93.69, 42.026], color: 'green' },
  { id: 'veracruz', name: 'Veracruz Costa, México', coords: [-96.35, 19.12], color: 'green' },
  { id: 'cerrado', name: 'Cerrado & Mato Grosso', coords: [-55.5, -12.5], color: 'amber' },
  { id: 'congo', name: 'Cuenca del Congo', coords: [21.5, -0.5], color: 'amber' }
];

const workspace = document.querySelector('.workspace-mission');
const satelliteShell = document.createElement('section');
satelliteShell.className = 'satellite-shell';
satelliteShell.setAttribute('aria-label', 'Visor orbital y mapa de operaciones');
satelliteShell.innerHTML = `
  <div id="satellite-map" aria-label="Globo terráqueo y telemetría de satélite"></div>
  
  <div class="hud-zoom-controls">
    <button class="hud-zoom-btn" id="zoom-in" title="Acercar visor">+</button>
    <button class="hud-zoom-btn" id="zoom-out" title="Alejar visor">−</button>
  </div>

  <div class="satellite-toolbar">
    <button id="explore-terrain">
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2"><path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3"/></svg>
      EXPLORAR TERRENO
    </button>
    <button id="return-globe">
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2"><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></svg>
      VISTA ORBITAL
    </button>
  </div>

  <div class="map-status" id="map-status" role="status">CONECTANDO A TELEMETRÍA ESPECTRAL…</div>
`;

workspace.prepend(satelliteShell);

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let satelliteMap = null;

function mapStatus(message) {
  const el = $('map-status');
  if (el) {
    el.textContent = message;
    el.hidden = !message;
  }
}

function flyToLocation(center, level) {
  if (!satelliteMap) return;
  const currentZoom = satelliteMap.getZoom();
  const duration = Math.min(6500, Math.max(1400, Math.abs(level - currentZoom) * 450));
  satelliteMap.flyTo({
    center,
    zoom: level,
    bearing: 0,
    pitch: 0,
    curve: 1.2,
    duration,
    animate: !reducedMotion
  });
}

function initializeExplorer() {
  if (!window.maplibregl) {
    mapStatus('NO SE PUDO CARGAR EL MOTOR WEBGL. RECARGA LA PÁGINA.');
    return;
  }

  try {
    const loadImagery = createImageryLoader();

    maplibregl.addProtocol('agrox-imagery', async (request, controller) => {
      const match = /^agrox-imagery:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
      if (!match) throw new Error('Invalid imagery request');
      const [, z, y, x] = match.map(Number);
      return loadImagery(z, x, y, controller.signal);
    });

    satelliteMap = new maplibregl.Map({
      container: 'satellite-map',
      center: [-76, 8],
      zoom: 1.25,
      minZoom: 0,
      maxZoom: 19,
      maxPitch: 0,
      dragRotate: false,
      attributionControl: false,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: true, alpha: true },
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          satellite: {
            type: 'raster',
            tileSize: 256,
            maxzoom: 19,
            tiles: ['agrox-imagery://{z}/{y}/{x}'],
            attribution: 'Imágenes satelitales © <a href="https://services.arcgisonline.com" target="_blank" rel="noopener">Esri</a>, NASA, USGS &amp; GIS Community'
          }
        },
        layers: [
          {
            id: 'satellite',
            type: 'raster',
            source: 'satellite',
            paint: { 'raster-fade-duration': 300 }
          }
        ],
        sky: {
          'sky-color': '#03060a',
          'horizon-color': '#0284c7',
          'fog-color': '#061320',
          'sky-horizon-blend': 0.85,
          'horizon-fog-blend': 0.55,
          'fog-ground-blend': 0.25
        }
      }
    });

    satelliteMap.touchZoomRotate.disableRotation();
    satelliteMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    satelliteMap.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    // Telemetría de coordenadas en tiempo real sobre el cursor
    satelliteMap.on('mousemove', e => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
      const lngStr = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
      const coordsEl = $('cursor-coords');
      if (coordsEl) coordsEl.textContent = `${latStr} ${lngStr}`;
    });

    // Agregar marcadores luminosos tácticos / Hotspots de biomasa (Foto 3)
    activeHotspots.forEach(spot => {
      const el = document.createElement('div');
      el.className = 'globe-hotspot-marker';
      el.innerHTML = `
        <div class="hotspot-pulse-ring ${spot.color === 'green' ? 'green' : ''}"></div>
        <div class="hotspot-center-dot ${spot.color === 'green' ? 'green' : ''}"></div>
        <div class="hotspot-callout-label">[${spot.name.toUpperCase()}]</div>
      `;

      el.addEventListener('click', () => {
        if (terrainLocations[spot.id]) {
          setRegion(spot.id);
          flyToLocation(spot.coords, 6);
        } else {
          toast(`HOTSPOT ORBITAL: ${spot.name.toUpperCase()} (ANOMALÍA TÉRMICA)`);
        }
      });

      new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(spot.coords)
        .addTo(satelliteMap);
    });

    satelliteMap.on('zoom', () => {
      const z = satelliteMap.getZoom();
      $('zoom-in').disabled = z >= 19;
      $('zoom-out').disabled = z <= 0;
    });

    satelliteMap.on('idle', () => mapStatus(''));
    satelliteMap.on('error', () => mapStatus('ALERTA: FALLO EN DESCARGA DE TESELA ESPECTRAL.'));
    satelliteMap.getCanvas().addEventListener('webglcontextlost', () => {
      mapStatus('FALLO DE ACELERACIÓN GRÁFICA. RECARGANDO SUBSISTEMA…');
    });

    new ResizeObserver(() => satelliteMap.resize()).observe(satelliteShell);

    $('zoom-in').onclick = () => satelliteMap.zoomIn({ duration: reducedMotion ? 0 : 450 });
    $('zoom-out').onclick = () => satelliteMap.zoomOut({ duration: reducedMotion ? 0 : 450 });
    $('explore-terrain').onclick = () => flyToLocation(terrainLocations[current], 15.5);
    $('return-globe').onclick = () => flyToLocation(satelliteMap.getCenter(), 1.25);

  } catch {
    mapStatus('ACELERACIÓN WEBGL NO DETECTADA. VERIFICA DRIVERS DE PANTALLA.');
  }
}

// Conectar selección de región con cámara
const originalSetRegion = setRegion;
setRegion = function (value) {
  originalSetRegion(value);
  if (terrainLocations[value]) {
    flyToLocation(terrainLocations[value], satelliteMap ? Math.max(5.5, satelliteMap.getZoom()) : 5.5);
  }
};

initializeExplorer();
