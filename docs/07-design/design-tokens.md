# Design tokens (tema oscuro)

> TL;DR: Tokens de color, radios, espaciado y tipografía del tema oscuro, muestreados de los mockups, más la escala NDVI canónica única (rojo→amarillo→verde). Fuente de verdad para `tailwind.config` y la escena 3D.
> Depende de: nada.
> Estado: draft (colores muestreados; radios/espaciado aprox.)
> Última revisión: 2026-11-14

Decisión: ADR-011 en [decisions](../00-overview/decisions.md). El dossier tenía una paleta clara (Forest, Agro Green, Mint, Solar, Canvas) con hex TBD; el **tema oscuro de los mockups pasa a ser el predominante**. Los nombres del dossier se conservan como alias de acento (ver abajo); un tema claro queda fuera del MVP.

Método: mediana de parches 7×7 px (superficies) y píxel más saturado/brillante (texto, deltas) con Pillow sobre los PNG originales 1600×900 ([ui-spec](ui-spec.md)). Los mockups son renders con ruido y anti-aliasing: valores redondeados, ±algunos niveles por canal.

## Superficies y bordes

| Token | Hex | Origen |
|---|---|---|
| `color.bg.app` | `#0B121B` | fondo del área central (medido) |
| `color.bg.sidebar` | `#121922` | barra lateral (medido) |
| `color.bg.panel` | `#161D26` | panel derecho (medido) |
| `color.bg.card` | `#1B232B` | tarjetas KPI, inputs de la barra superior (medido, rango `#171E26`–`#2B333E`) |
| `color.bg.card-raised` | `#202C34` | tarjeta "AGROX AI" (medido) |
| `color.bg.nav-active` | `#1B422E` | ítem de menú activo (medido, verde tenue) |
| `color.border.subtle` | `#2B333E` | bordes de tarjeta/separadores (aprox.) |
| `color.overlay.scrim` | `#090D13` con alfa 0.8 | fondos de etiquetas flotantes (aprox.) |

## Acentos (verde)

| Token | Hex | Uso | Alias dossier |
|---|---|---|---|
| `color.accent.bright` | `#7EE36D` | pestaña activa, toggle NDVI, borde de parcela | Mint |
| `color.accent.soft` | `#A0DA94` | barras de progreso, logo | Agro Green |
| `color.accent.strong` | `#107432` | fondo de CTA principal | Forest |
| `color.accent.muted` | `#5A8549` | segmento seleccionado ("Medio") | — |
| `color.chart.area` | `#234B33` | relleno de gráficas de área | — |

## Texto

| Token | Hex | Uso |
|---|---|---|
| `color.text.primary` | `#FFFFFF` | títulos, valores KPI (medido) |
| `color.text.secondary` | `#C5CED5` | subtítulos, leyendas pequeñas (medido en texto pequeño; aprox.) |
| `color.text.muted` | `#8A949E` | "vs. período anterior", ejes (aprox.) |
| `color.text.on-accent` | `#0B121B` | texto sobre `accent.bright` (aprox.) |

## Estados

| Token | Hex | Uso |
|---|---|---|
| `color.state.up` / `ok` | `#81D740` | delta favorable, check (medido; texto claro `#B1EA9D`) |
| `color.state.down` / `alert` | `#F15F48` | delta desfavorable, notificación (medido) |
| `color.state.warn` | `#F3B406` | "Estrés esperado", advertencias (medido) — alias Solar |
| `color.state.synthetic` | `#F3B406` | banner/insignia SYNTHETIC (decisión: reutiliza warn) |

Regla: el color nunca es el único portador de significado; los deltas llevan ▲/▼ y signo.

## Escala NDVI canónica (única)

Los mockups usan dos escalas distintas (S2: ≤0.2 / 0.2–0.5 / ≥0.5; S3: 0.30–0.90). **Decisión revisable (ADR-011):** una sola rampa continua con dominio fijo, igual en mapa 2D, overlay del backend, escena 3D y leyendas.

| Parada NDVI | Hex | Lectura de leyenda |
|---|---|---|
| ≤ 0.20 | `#DC342E` | Suelo desnudo / vegetación muy escasa |
| 0.35 | `#F19728` | Baja |
| 0.50 | `#F0E533` | Media |
| 0.65 | `#6FBE30` | Alta |
| ≥ 0.80 | `#319D34` | Muy alta |
| < 0 (agua, nubes enmascaradas) | `#4B5563` | Sin dato / no vegetación |

- Colores muestreados de las leyendas de S2/S3 (interpolados a las paradas). Las etiquetas de lectura son cualitativas; **no** son umbrales agronómicos por cultivo (TBD verificar fuente si se usan para alertas).
- Interpolación lineal en espacio RGB entre paradas; fuera de dominio se recorta.
- La leyenda siempre muestra fuente y resolución (p. ej. "MODIS 250 m · 16 días").

## Radios, espaciado, sombras (aprox.)

| Token | Valor | Uso |
|---|---|---|
| `radius.sm` | 6 px | chips, casillas |
| `radius.md` | 10 px | botones, inputs, mosaicos KPI |
| `radius.lg` | 16 px | paneles y tarjetas grandes |
| `space` | escala de 4 px (4, 8, 12, 16, 24, 32) | padding de tarjetas 16–24 px |
| `shadow.panel` | sombra suave negra + borde `border.subtle` | paneles flotantes |

## Tipografía

Sans-serif geométrica/humanista de ancho medio (fuente concreta TBD; no identificable con certeza en los mockups). Pesos: 600–700 para títulos y valores KPI, 400–500 para cuerpo. Tamaños aprox.: valor KPI 24–28 px, título de panel 20–22 px, cuerpo 14–15 px, leyenda 11–12 px. Cifras tabulares (`font-variant-numeric: tabular-nums`) en KPI y ejes. Unidades siempre visibles.

## Implementación

`frontend/src/styles/tokens.ts` exporta estos valores; `tailwind.config.ts` los consume; la escena 3D importa la rampa NDVI del mismo archivo (cero duplicación).
