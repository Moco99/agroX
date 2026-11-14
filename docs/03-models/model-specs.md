# Especificaciones de modelos

> TL;DR: Ecuaciones, entradas, salidas y unidades de ET0 (PM y Hargreaves), Kc, balance hídrico, GDD, score, anomalía y NDVI. Sin parámetros de cultivo inventados: esos viven en el catálogo.
> Depende de: [models-catalog](models-catalog.md)
> Estado: draft (verificar cada ecuación contra FAO-56 al implementar; citar ec. en docstring)
> Última revisión: 2026-11-14

Referencia principal: Allen et al. (1998), FAO Irrigation and Drainage Paper 56 ("FAO-56"). Unidades canónicas: [glossary](../00-overview/glossary.md).

## 1. ET0 Penman-Monteith FAO-56 (diaria)

```
ET0 = [0.408·Δ·(Rn − G) + γ·(900/(T + 273))·u2·(es − ea)] / [Δ + γ·(1 + 0.34·u2)]
```

| Símbolo | Significado | Unidad | Origen (POWER) |
|---|---|---|---|
| T | temperatura media diaria | °C | `T2M` (o (T2M_MAX+T2M_MIN)/2, decidir y documentar) |
| u2 | viento a 2 m | m/s | `WS2M` |
| Rn | radiación neta | MJ m⁻² día⁻¹ | derivada de `ALLSKY_SFC_SW_DWN` (Rs) según FAO-56 ecs. 37–40 (Rso, Rns con albedo de referencia, Rnl) |
| G | flujo de calor del suelo | MJ m⁻² día⁻¹ | ≈ 0 en paso diario (FAO-56) |
| es, ea | presión de vapor de saturación / real | kPa | es de T_max/T_min; ea de `RH2M` (FAO-56, ecuación con RH media) |
| Δ | pendiente de la curva de presión de vapor | kPa °C⁻¹ | de T |
| γ | constante psicrométrica | kPa °C⁻¹ | de presión atmosférica por elevación (SRTM o elevación del sitio) |

Salida: ET0 en mm/día, `data_state = ESTIMATED` (o `SYNTHETIC` si el clima lo es).
**Antes de implementar:** confirmar unidades de `ALLSKY_SFC_SW_DWN` en la respuesta AG (O-6). Si viene en kWh m⁻² día⁻¹, convertir (1 kWh = 3.6 MJ).

## 2. ET0 Hargreaves (respaldo)

```
ET0 = 0.0023 · (T_mean + 17.8) · (T_max − T_min)^0.5 · Ra
```
Ra = radiación extraterrestre expresada como evaporación equivalente (mm/día; Ra[MJ] × 0.408), calculada de latitud y día del año (FAO-56). Usar cuando faltan RH/viento/radiación; registrar en provenance `method = "hargreaves"`.

## 3. Coeficiente de cultivo

```
ETc = Kc · ET0
```
Kc por etapa: `kc_ini` (inicial), lineal `kc_ini→kc_mid` (desarrollo), `kc_mid` (media), lineal `kc_mid→kc_end` (final). Valores: [crop-catalog](../02-modules/crop-catalog.md) (TBD, verificar FAO-56 tabla 12; ajuste climático de Kc_mid por RH y viento = stretch).

## 4. Balance hídrico de la zona radicular (FAO-56 cap. 8)

```
TAW   = 1000 · (θ_FC − θ_WP) · Zr            # mm  (o AWC[mm/m] · Zr)
RAW   = p · TAW                              # mm
Dr_i  = Dr_{i−1} − (P_i − RO_i) − I_i − CR_i + ETc_i + DP_i
Ks    = 1                                    si Dr ≤ RAW
Ks    = (TAW − Dr) / ((1 − p) · TAW)         si Dr > RAW
ETc_adj = Ks · Kc · ET0
```
- Dr = depleción (mm), acotada a `[0, TAW]`; el exceso sobre capacidad de campo sale como DP (percolación).
- RO (escorrentía): MVP = 0 o regla simple documentada; CR (ascenso capilar) = 0 en MVP. Registrar como supuestos.
- Zr crece por etapa entre `root_depth_min_m` y `root_depth_max_m` (catálogo).
- Entradas de suelo (`awc_mm_per_m`): SSURGO/SDA en real; sintético en F1.

## 5. Grados-día

```
GDD_i = max(0, (T_max,i + T_min,i)/2 − T_base)
```
Variante con topes (p. ej. método usado para maíz en EE.UU. con `t_cap_gdd`): TBD, verificar fuente y documentar cuál se usa. `T_base` por cultivo en el catálogo (TBD).

## 6. Score multicriterio

```
S = w_a·A + w_s·S_suelo + w_c·C        con w_a + w_s + w_c = 1 ;  A, S_suelo, C ∈ [0, 100]  ⇒ S ∈ [0, 100]
```
Pesos normalizados por el contrato (`Weights`). Definición operativa de A/S_suelo/C: propuesta en [rotation-engine](../02-modules/rotation-engine.md) (O-8). Los coeficientes son configuración del producto, no parámetros científicos.

## 8. Anomalía de precipitación

```
anomaly_pct = (P_period − mean(P_same_period_historical)) / mean(P_same_period_historical) · 100
```
Requiere climatología del mismo periodo (ver deuda b en [data-pipeline](../02-modules/data-pipeline.md)). Si la media histórica es 0, devolver `null` + warning.

## 9. SPI

Ajustar distribución gamma a la precipitación acumulada (escala k meses) por mes calendario y transformar a normal estándar. Requiere serie larga (orden de 30 años, verificar recomendación OMM). SPEI: misma idea sobre P − ET0 (distribución log-logística). Stretch.

## 12–13. Escenarios

- **Años análogos:** distancia entre el año objetivo y cada año histórico sobre un vector de rasgos (p. ej. P acumulada, T media, SPI en meses previos); tomar los k más cercanos; simular el resto de la temporada con su clima. k y rasgos: TBD.
- **Monte Carlo:** N realizaciones; perturbar `precip_factor` y `temp_delta_c` o remuestrear bloques de días históricos; reportar p10/p50/p90. N y distribuciones: TBD. Siempre con `rng` sembrado.

## 15. Nudging (stretch)

```
x_i⁺ = x_i⁻ + K · (y_i − H(x_i⁻))     con 0 ≤ K ≤ 1
```
x = estado (p. ej. Dr o etapa), y = observación, H = operador observación (p. ej. NDVI→fracción de cobertura). K fijo (nudging) o de varianzas (Kalman). Solo si hay H defendible.

## 16. NDVI: suavizado y doble logística

```
NDVI(t) = v_min + (v_max − v_min) · [ 1/(1 + e^{−m1(t − n1)}) − 1/(1 + e^{−m2(t − n2)}) ]
```
Antes: filtrar QA/nubes, Savitzky-Golay (ventana y orden TBD). Salida: `n1` ≈ inicio de verdor, `n2` ≈ senescencia, pico de NDVI. Comparar con fechas de etapa del gemelo → `Discrepancy` en días.
