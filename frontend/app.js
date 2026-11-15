/* ═════════════════════════════════════════════════════════════════════════
   AGROX // ORBITAL RADIOMETRY & MISSION CONTROL APP ENGINE
   ═════════════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

// Datos de telemetría de regiones
const regions = {
  mexico: {
    name: 'Bajío de México',
    code: 'SECTOR-01',
    lat: 20.63,
    lon: -101.25,
    coordsStr: "20°37'N 101°15'W",
    rain: 64,
    temp: 20.8,
    solar: 23.6,
    ndvi: 0.72,
    soilMoisture: 62,
    modisHits: 1420,
    viirsHits: 4892,
    spectralRes: 1299,
    crops: [78, 94, 85]
  },
  argentina: {
    name: 'Centro-Norte de Argentina',
    code: 'SECTOR-02',
    lat: -31.45,
    lon: -61.55,
    coordsStr: "31°27'S 61°33'W",
    rain: 186,
    temp: 24.1,
    solar: 21.3,
    ndvi: 0.75,
    soilMoisture: 71,
    modisHits: 2150,
    viirsHits: 5640,
    spectralRes: 1340,
    crops: [92, 87, 79]
  },
  iowa: {
    name: 'Iowa Corn Belt, USA',
    code: 'SECTOR-03',
    lat: 42.026,
    lon: -93.69,
    coordsStr: "42°01'N 93°41'W",
    rain: 92,
    temp: 8.4,
    solar: 14.8,
    ndvi: 0.65,
    soilMoisture: 58,
    modisHits: 980,
    viirsHits: 3410,
    spectralRes: 1180,
    crops: [95, 96, 72]
  },
  veracruz: {
    name: 'Veracruz Costa, México',
    code: 'SECTOR-04',
    lat: 19.12,
    lon: -96.35,
    coordsStr: "19°07'N 96°21'W",
    rain: 172,
    temp: 25.4,
    solar: 22.1,
    ndvi: 0.78,
    soilMoisture: 80,
    modisHits: 1840,
    viirsHits: 5120,
    spectralRes: 1410,
    crops: [88, 82, 70]
  }
};

let current = 'mexico';
let month = 5;
let playTimer = null;
let chartPeriod = 6;
let activeBand = 'NDVI';

const dates = ['30 SEP 2024', '31 OCT 2024', '30 NOV 2024', '31 DIC 2024', '31 ENE 2025', '28 FEB 2025'];
const values = [0.55, 0.66, 0.79, 0.75, 0.72, 0.72];
const fmt = n => n.toLocaleString('es-MX', { maximumFractionDigits: 2 });

// Reloj UTC en vivo
function updateClockUTC() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25) + ' UTC';
  const el = $('clock-utc');
  if (el) el.textContent = utc;
}
setInterval(updateClockUTC, 1000);
updateClockUTC();

// Toast de notificación táctica
function toast(message) {
  const t = $('toast');
  if (!t) return;
  t.innerHTML = `<span style="color:var(--cyan);margin-right:6px">●</span> ${message}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3600);
}

// Diálogo modal
function detail(title, body) {
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = body;
  $('detail-dialog').showModal();
}
$('close-dialog').onclick = $('dialog-done').onclick = () => $('detail-dialog').close();
$('detail-dialog').addEventListener('click', e => {
  if (e.target === $('detail-dialog')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      e.target.close();
    }
  }
});

// Renderizado del osciloscopio / Gráfico NDVI
function chart() {
  const short = chartPeriod === 3;
  const series = short ? [0.75, 0.74, 0.72, 0.72, 0.71, 0.72] : [0.55, 0.58, 0.61, 0.65, 0.69, 0.71, 0.73, 0.76, 0.80, 0.77, 0.74, 0.72];
  const offset = regions[current].ndvi - 0.72;
  const pts = series.map((v, i) => [
    40 + (i * 420) / (series.length - 1),
    155 - (v + offset - 0.35) * 230
  ]);
  const line = pts.map(p => p.join(',')).join(' ');

  let html = `
    <defs>
      <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
      </linearGradient>
      <filter id="laser-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
  `;

  // Líneas de cuadrícula milimétrica
  for (let i = 0; i < 5; i++) {
    const y = 30 + i * 28;
    html += `<path d="M40 ${y}H470" stroke="rgba(56,189,248,0.12)" stroke-dasharray="2,3"/>
             <text x="6" y="${y + 4}" fill="#64748b" font-size="9" font-family="JetBrains Mono">${(0.9 - i * 0.1).toFixed(2)}</text>`;
  }

  // Polígono y línea osciloscopio
  html += `
    <polygon points="40,155 ${line} 460,155" fill="url(#area-grad)"/>
    <polyline points="${line}" stroke="#38bdf8" stroke-width="2.2" fill="none" stroke-linejoin="round" filter="url(#laser-glow)"/>
  `;

  // Etiquetas de fecha
  const labels = short ? ['DIC 2024', 'ENE 2025', 'FEB 2025'] : ['SEP 24', 'OCT 24', 'NOV 24', 'DIC 24', 'ENE 25', 'FEB 25'];
  labels.forEach((label, i) => {
    const x = 55 + (i * 390) / (labels.length - 1);
    html += `<text x="${x}" y="176" text-anchor="middle" fill="#64748b" font-size="9" font-family="JetBrains Mono">${label}</text>`;
  });

  // Punto focal activo
  const point = pts[pts.length - 1];
  html += `
    <circle cx="${point[0]}" cy="${point[1]}" r="5" fill="#38bdf8" filter="url(#laser-glow)"/>
    <circle cx="${point[0]}" cy="${point[1]}" r="2" fill="#fff"/>
    <rect x="${point[0] - 68}" y="${point[1] - 42}" width="65" height="24" rx="4" fill="#081420" stroke="#38bdf8" stroke-width="1"/>
    <text x="${point[0] - 35}" y="${point[1] - 26}" text-anchor="middle" fill="#38bdf8" font-size="11" font-weight="700" font-family="JetBrains Mono">${fmt(regions[current].ndvi)}</text>
  `;

  $('ndvi-chart').innerHTML = html;
}

// Actualización de métricas generales y telemetría
function update() {
  const r = regions[current];

  // Cuadrante de 4 gauges
  $('ndvi-value').textContent = fmt(values[month] + r.ndvi - 0.72);
  $('rain-value').innerHTML = `${Math.round(r.rain * (0.65 + month * 0.07))} <em>mm</em>`;
  $('temp-value').innerHTML = `${fmt(r.temp + (month - 5) * 0.7)} <em>°C</em>`;
  $('solar-value').innerHTML = `${fmt(r.solar + (month - 5) * 0.3)} <em>MJ/m²</em>`;

  // Ticker de telemetría inferior (Fotos 2 y 3)
  $('ticker-modis').textContent = (r.modisHits + month * 35).toLocaleString();
  $('ticker-viirs').textContent = (r.viirsHits + month * 82).toLocaleString();
  $('ticker-res').textContent = (r.spectralRes).toLocaleString();

  // Retícula de objetivo flotante
  $('reticle-region-name').textContent = `${r.name.toUpperCase()} [${r.code}]`;
  $('reticle-coords').textContent = r.coordsStr;
  $('reticle-ndvi').textContent = fmt(values[month] + r.ndvi - 0.72);
  $('reticle-rain').textContent = `${Math.round(r.rain * (0.65 + month * 0.07))} mm`;
  $('reticle-soil').textContent = `${r.soilMoisture}%`;

  // Fechas y línea de tiempo
  $('timeline-date').textContent = dates[month];
  $('updated-date').textContent = dates[month];
  $('timeline').value = month;
  $('previous').disabled = month === 0;
  $('next').disabled = month === 5;

  // Actualizar ticks de la línea de tiempo
  const tickSpans = document.querySelectorAll('.timeline-ticks span');
  tickSpans.forEach((span, i) => {
    span.classList.toggle('active', i === month);
  });

  // Matriz de cultivos
  const cropNames = ['Soja de Grano', 'Maíz Híbrido', 'Trigo de Invierno'];
  const cropIcons = ['🌱', '🌽', '🌾'];
  $('crop-list').innerHTML = cropNames.map((name, i) => `
    <div class="crop-row-hud" data-crop="${i}" role="button" tabindex="0">
      <span class="crop-ico">${cropIcons[i]}</span>
      <span class="crop-name">${name}</span>
      <div class="crop-track-hud">
        <div class="crop-fill-hud" style="width:${r.crops[i]}%"></div>
      </div>
      <strong class="crop-pct">${r.crops[i]}%</strong>
    </div>
  `).join('');

  chart();
  updateBookmark();
}

// Fijación de región
function setRegion(value) {
  if (!regions[value]) return;
  current = value;
  $('region').value = value;
  const r = regions[value];
  update();
  $('search-results').hidden = true;
  $('search').value = '';
  toast(`OBJETIVO FIJADO: ${r.name.toUpperCase()} [${r.code}]`);
}

$('region').onchange = e => setRegion(e.target.value);

// Búsqueda táctica con ⌘K
$('search').oninput = e => {
  const q = e.target.value.trim().toLocaleLowerCase('es');
  $('search-results').hidden = !q;
  const matches = Object.entries(regions).filter(([key, r]) => (key + ' ' + r.name + ' ' + r.code).toLocaleLowerCase('es').includes(q));
  $('search-results').innerHTML = matches.length
    ? matches.map(([key, r]) => `<button data-region="${key}">[${r.code}] ${r.name}</button>`).join('')
    : '<p>OBJETIVO NO IDENTIFICADO. PRUEBA: BAJÍO, IOWA, ARGENTINA, VERACRUZ.</p>';
};

$('search-results').onclick = e => {
  const b = e.target.closest('[data-region]');
  if (b) setRegion(b.dataset.region);
};

$('search').onkeydown = e => {
  if (e.key === 'Enter') $('search-results').querySelector('button')?.click();
  if (e.key === 'Escape') $('search-results').hidden = true;
};

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('search').focus();
  }
});

// Selector de periodo de osciloscopio
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartPeriod = Number(btn.dataset.period);
    chart();
  };
});

// Selector de bandas espectrales
document.querySelectorAll('.band-chip').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.band-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeBand = btn.dataset.band;
    toast(`CALIBRACIÓN ESPECTRAL: BANDA ${activeBand} ACTIVADA`);
  };
});

// Control temporal y reproducción
$('timeline').oninput = e => {
  month = +e.target.value;
  update();
};

$('previous').onclick = () => {
  month = Math.max(0, month - 1);
  update();
};

$('next').onclick = () => {
  month = Math.min(5, month + 1);
  update();
};

function stopPlayback() {
  clearInterval(playTimer);
  playTimer = null;
  $('play').innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
}

$('play').onclick = () => {
  if (playTimer) {
    stopPlayback();
    return;
  }
  if (month === 5) {
    month = 0;
    update();
  }
  $('play').innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>';
  playTimer = setInterval(() => {
    month++;
    update();
    if (month === 5) stopPlayback();
  }, 1200);
};

// Capas tácticas
document.querySelectorAll('#layer-chips input').forEach(el => {
  el.onchange = () => {
    toast(`CAPA ESPECTRAL: ${el.value.toUpperCase()} ${el.checked ? 'ACTIVADA' : 'DESACTIVADA'}`);
  };
});

// Guardado de regiones (Bookmarks)
let saved = [];
try {
  saved = JSON.parse(localStorage.getItem('agrox-regions') || '[]');
  if (!Array.isArray(saved)) saved = [];
} catch {}

function updateBookmark() {
  const active = saved.includes(current);
  $('bookmark').setAttribute('aria-pressed', active);
  $('bookmark').style.color = active ? 'var(--cyan)' : '';
}

$('bookmark').onclick = () => {
  if (saved.includes(current)) saved = saved.filter(x => x !== current);
  else saved.push(current);
  try {
    localStorage.setItem('agrox-regions', JSON.stringify(saved));
  } catch {}
  updateBookmark();
  toast(saved.includes(current) ? 'SECTOR REGISTRADO EN MEMORIA TÁCTICA' : 'SECTOR REMOVIDO DE MEMORIA');
};

// Matriz de cultivos: modal de compatibilidad
$('crop-list').onclick = e => {
  const row = e.target.closest('[data-crop]');
  if (!row) return;
  const idx = +row.dataset.crop;
  const names = ['Soja de Grano', 'Maíz Híbrido', 'Trigo de Invierno'];
  detail(
    `COMPATIBILIDAD BIOCLIMÁTICA: ${names[idx]}`,
    `Afinidad agronómica calculada: <strong style="color:var(--cyan);font-size:16px">${regions[current].crops[idx]}%</strong> para el sector ${regions[current].name}.
     <p style="margin-top:10px">Parámetros integrados: Radiación solar incidente, curva fenológica GDD, régimen hídrico superficial y balance hídrico FAO-56.</p>`
  );
};

$('crop-help').onclick = () => detail(
  'METODOLOGÍA DE ÍNDICE RADIOMÉTRICO',
  'El índice de compatibilidad bioclimática pondera los datos de radiometría orbital (MODIS/VIIRS), humedad de suelo radar (SMAP) y temperatura superficial (ERA5).'
);

$('help').onclick = () => detail(
  'MANUAL DE OPERACIONES TÁCTICAS // AGROX',
  `<strong>VISOR ORBITAL:</strong> Arrastra para girar el globo terrestre. Rueda o botones para zoom continuo.<br><br>
   <strong>PUNTOS DE INTERÉS:</strong> Haz clic en cualquier hotspot luminoso del globo para fijar el objetivo.<br><br>
   <strong>TELEMETRÍA:</strong> Explora la firma espectral NDVI y reproduce la serie histórica mes a mes.`
);

$('notifications').onclick = () => detail(
  'BITÁCORA DE TELEMETRÍA',
  '● Telemetría satelital sincronizada con éxito.<br>● Enlace Sentinel-2A en banda X nominal.<br>● Próximo paso orbital sobre el Bajío en T+01:42:15.'
);

// Exportar telemetría CSV
function exportReport() {
  const r = regions[current];
  const content = '\uFEFF' + `AGROX // TELEMETRIA ORBITAL\nSector,"${r.name}"\nCodigo,${r.code}\nFecha,${dates[month]}\nNDVI,${(values[month] + r.ndvi - 0.72).toFixed(2)}\nPrecipitacion_mm,${Math.round(r.rain * (0.65 + month * 0.07))}\nTemperatura_C,${(r.temp + (month - 5) * 0.7).toFixed(1)}\nRadiacion_MJm2,${(r.solar + (month - 5) * 0.3).toFixed(1)}\nCultivo_Soja_Pct,${r.crops[0]}\nCultivo_Maiz_Pct,${r.crops[1]}\nCultivo_Trigo_Pct,${r.crops[2]}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `agrox-telemetry-${current}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('TELEMETRÍA CSV EXPORTADA EXITOSAMENTE');
}
$('more').onclick = exportReport;

// Botón de centrado de objetivo
$('btn-lock').onclick = () => {
  if (typeof flyToLocation === 'function' && typeof terrainLocations !== 'undefined') {
    flyToLocation(terrainLocations[current], 12);
    toast(`INICIANDO APROXIMACIÓN A SECTOR: ${regions[current].name.toUpperCase()}`);
  }
};

// Pantalla completa
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast('MODO PANTALLA COMPLETA NO COMPATIBLE');
  }
};

// Navegación de pestañas
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    if (view === 'Exploración') return;
    detail(
      `MÓDULO: ${view.toUpperCase()}`,
      `El módulo ${view} está en proceso de acoplamiento con la telemetría del gemelo digital. Actualmente visualizando telemetría orbital de operaciones.`
    );
  };
});

update();
