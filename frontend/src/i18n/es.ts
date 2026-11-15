import type { DataState, IrrigationLevel, PhenoStage, StressClass } from "../types/api";

// ─────────────────────────────────────────
// Section: es-MX UI copy (single source; components never hard-code visible text)
// ─────────────────────────────────────────

export const es = {
  app: {
    name: "AGROX",
    tagline: "Gemelo digital agrícola",
    loading: "Cargando gemelo digital…",
    retry: "Reintentar",
    backendDown: "No se pudo conectar con el backend (¿está corriendo en el puerto 8000?).",
    illustrative: "Representación ilustrativa — no es una predicción",
    exploratory: "Simulación exploratoria, no predicción de rendimiento",
  },
  nav: {
    exploration: "Exploración",
    vegetation: "Vegetación",
    climate: "Clima",
    rotations: "Rotaciones",
    scenarios: "Escenarios",
    reports: "Informes",
    soon: "próximamente",
    aiTitle: "AGROX AI",
    aiBody: "Explicaciones por plantillas a partir del motor. Sin IA generativa en esta versión.",
  },
  topbar: {
    search: "Granja piloto · Story County, Iowa (EE. UU.)",
    season: "Temporada",
    period: "Periodo",
    layers: (n: number) => `Capas (${n})`,
  },
  banner: {
    synthetic: "Datos sintéticos — no representan la parcela real",
    real: "Datos reales: NASA POWER, USDA CDL, SSURGO, NASADEM, MODIS, Sentinel-2, SMAP",
    provisional: "Parámetros de cultivo provisionales (sin verificar)",
    warnings: (n: number) => `${n} avisos de datos`,
    hide: "Ocultar",
    show: "Ver",
    twinLevel: {
      DIGITAL_MODEL: "Modelo digital",
      DIGITAL_SHADOW: "Sombra digital",
      DIGITAL_TWIN: "Gemelo digital",
    },
    twinLevelHint:
      "Sombra digital: el clima real alimenta el modelo y se compara con observaciones independientes, pero no se asimilan.",
  },
  layers: {
    title: "Capas activas",
    ndvi: "NDVI observado",
    stress: "Estrés hídrico",
    moisture: "Humedad del suelo",
    temperature: "Temperatura",
    irrigation: "Riego",
  },
  timeline: {
    play: "Reproducir",
    pause: "Pausa",
    prev: "Día anterior",
    next: "Día siguiente",
    stages: {
      PRE_PLANTING: "Presiembra",
      INITIAL: "Siembra",
      DEVELOPMENT: "Desarrollo",
      MID_SEASON: "Floración",
      LATE_SEASON: "Llenado",
      HARVESTED: "Cosecha",
    } satisfies Record<PhenoStage, string>,
    stageNote: "Etapas FAO-56 por grados-día (Floración = media temporada, Llenado = final)",
  },
  twin: {
    tabs: { twin: "Gemelo digital", map2d: "Mapa 2D" },
    panelTitle: "Gemelo digital de la granja",
    tabsPanel: { summary: "Resumen", scenario: "Escenario", charts: "Gráficas", data: "Datos" },
    scenario: "Escenario",
    conditions: "Condiciones de simulación",
    precipReduction: "Cambio de precipitación",
    tempIncrease: "Cambio de temperatura",
    irrigation: "Nivel de riego",
    forkFrom: "Aplicar escenario desde",
    forkWhole: "toda la temporada",
    forkCurrent: "la fecha actual",
    reset: "Restablecer",
    monteCarlo: "Incertidumbre de parámetros (Monte Carlo, 40 corridas)",
    simulating: "Simulando…",
    selectedZone: "Zona seleccionada",
    allZones: "Granja (promedio por área)",
    soilWater: "Agua disponible",
    stage: "Etapa",
    zoneHint: "Haz clic en una zona del diorama para ver su detalle.",
    noWebgl: "WebGL no disponible: se muestra el mapa 2D equivalente.",
    compass: "N",
    scale: (m: number) => `${m} m`,
    presets: {
      custom: "Personalizado",
      baseline: "Línea base (clima observado)",
      moderate_drought: "Sequía moderada",
      severe_drought: "Sequía severa",
      wet_cool: "Húmedo y fresco",
      heat_wave: "Ola de calor",
    } as Record<string, string>,
  },
  irrigation: {
    NONE: "Sin riego",
    LOW: "Bajo",
    MEDIUM: "Medio",
    HIGH: "Alto",
  } satisfies Record<IrrigationLevel, string>,
  kpi: {
    ndvi: "NDVI",
    temperature: "Temperatura máx.",
    precipitation: "Precipitación acumulada",
    soilMoisture: "Humedad del suelo",
    stress: "Estrés esperado",
    vsBaseline: "vs. línea base",
    observedOn: (d: string, src: string) => `observado ${d} · ${src}`,
    noObservation: "sin observación",
    ofTaw: "% de TAW",
  },
  stressClass: {
    NONE: "Sin estrés",
    LOW: "Bajo",
    MEDIUM: "Medio",
    HIGH: "Alto",
  } satisfies Record<StressClass, string>,
  dataState: {
    MEASURED: "Medido",
    DECLARED: "Declarado",
    ESTIMATED: "Estimado",
    SIMULATED: "Simulado",
    SYNTHETIC: "Sintético",
  } satisfies Record<DataState, string>,
  crops: { corn: "Maíz", soybean: "Soya", cereal_rye: "Centeno" } as Record<string, string>,
  charts: {
    soilWater: "Agua disponible en zona radicular (% de TAW)",
    ks: "Coeficiente de estrés hídrico Ks (1 = sin estrés)",
    gdd: "Grados-día acumulados (°C·día) y etapas",
    ndvi: "NDVI observado vs. forma de dosel esperada",
    ndviNote: "El gemelo no simula NDVI: la curva esperada es el Kc normalizado (solo forma y fechas).",
    smap: "Humedad superficial SMAP (contexto regional 9 km) vs. agua simulada",
    smapNote: "SMAP mide ~5 cm en una celda de 9 km y sus retrievals están marcados de calidad no recomendada.",
    baseline: "Línea base",
    scenario: "Escenario",
    threshold: "Umbral de estrés (1 − p)",
    modis: "MODIS 250 m",
    s2: "Sentinel-2 10 m",
    expected: "Dosel esperado (índice 0–1)",
    smapSeries: "SMAP (m³/m³)",
    simulated: "Simulado (% TAW)",
    metrics: (src: string, n: number, r: string, lag: string) => `${src}: n=${n} · r=${r} · desfase=${lag}`,
  },
  explanation: {
    title: "Explicación de AGROX AI",
    subtitle: "Generada por plantillas a partir de las salidas del motor",
    suggestion: "Sugerencia exploratoria",
  },
  parcel: {
    title: "Parcela con NDVI",
    overlay: "Overlay NDVI Sentinel-2",
    zones: "Zonas de manejo",
    noOverlay: "Sin overlay NDVI disponible en este modo de datos.",
    legend: "Vigor vegetal (NDVI)",
    resolution: (m: number, d: string) => `Resolución ${m} m · escena ${d}`,
    history: "Historial CDL (cultivo por año)",
    soil: "Suelo dominante (SSURGO)",
    terrain: "Pendiente media (NASADEM)",
    series: "Evolución del NDVI por zona",
    awc: "AWC",
    hydgrp: "Grupo hidrológico",
    drainage: "Drenaje",
    erosion: { low: "baja", moderate: "moderada", high: "alta", unknown: "desconocida" } as Record<string, string>,
    erosionLabel: "Índice de erosión",
    ndviLatest: "NDVI a la fecha",
    coverageNote: "Sentinel-2 solo cubre el final de temporada (31 ago–30 sep 2024).",
  },
  legend: {
    ndvi: ["Suelo desnudo", "Baja", "Media", "Alta", "Muy alta"],
  },
} as const;

export function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}
