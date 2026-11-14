# Datos sintéticos

> TL;DR: Generadores deterministas (seed fija) de clima multi-año, suelo, parámetros de cultivo y NDVI para construir el gemelo antes de tener datos reales. Todo sale con data_state = SYNTHETIC y aviso visible.
> Depende de: [data-contracts](../01-architecture/data-contracts.md)
> Estado: draft
> Última revisión: 2026-11-14

Decisión: ADR-004 en [decisions](../00-overview/decisions.md). Los valores de este modo son **sintéticos, no científicos**: sirven para probar el flujo, no para concluir nada.

## Qué se genera

| Puerto | Adaptador | Generación | Salida |
|---|---|---|---|
| `WeatherProvider` | `SyntheticWeatherProvider` | Ciclo anual senoidal para T (media, amplitud), T_max/T_min = media ± rango diario, ruido gaussiano AR(1); lluvia: ocurrencia por cadena de Markov de 2 estados + cantidad gamma; RH, radiación y viento con estacionalidad + ruido; **multi-año** (p. ej. 30 años) para análogos, anomalías y Monte Carlo | `WeatherSeries` |
| `SoilProvider` | `SyntheticSoilProvider` | Perfil fijo: AWC, profundidad, textura y drenaje plausibles para un franco | `SoilProfile` |
| `CropCatalogProvider` | `SyntheticCropCatalogProvider` | corn, soybean, cobertura con parámetros provisionales completos (sin `null`) y `verified = false` | `CropCatalog` |
| `ObservationProvider` | `SyntheticObservationProvider` | NDVI con doble logística (modelo 16) cada 16 días + ruido + huecos simulados por nubes; opcional: humedad superficial | `ObservationSeries` |

Los parámetros de los generadores (medias, amplitudes, probabilidades) viven en un único archivo `backend/app/providers/synthetic/params.py`, comentado como "synthetic, not scientific". Pueden inspirarse en el orden de magnitud del clima de Iowa, pero no se presentan como datos de Iowa.

## Reproducibilidad

- Seed fija por defecto: `AGROX_SYNTHETIC_SEED` (default `20261114`).
- Cada generador recibe un `numpy.random.Generator`; nada usa `np.random.*` global ni `random`.
- Misma seed + mismos parámetros ⇒ mismos datos byte a byte (test golden).
- Provenance: `source = "synthetic:<generator>_v<n>"`, `data_state = SYNTHETIC`, `version` = versión del generador.

## Ejemplo (estructura del generador de clima)

```python
import numpy as np
import pandas as pd

from app.providers.synthetic import params as P


# Seasonal cycle peaks in mid-July (day ~196) to mimic a northern mid-latitude summer
def synthetic_temperature(days: pd.DatetimeIndex, rng: np.random.Generator) -> pd.Series:
    doy = days.dayofyear.to_numpy()
    seasonal = P.T_MEAN_ANNUAL + P.T_AMPLITUDE * np.cos(2 * np.pi * (doy - P.T_PEAK_DOY) / 365.25)
    noise = np.empty(len(days))
    noise[0] = rng.normal(0.0, P.T_NOISE_SD)
    # AR(1) noise keeps warm and cold spells persistent across consecutive days
    for i in range(1, len(days)):
        noise[i] = P.T_AR1 * noise[i - 1] + rng.normal(0.0, P.T_NOISE_SD)
    return pd.Series(seasonal + noise, index=days, name="t_mean")
```

## Etiquetado y UI

- Cualquier respuesta que contenga al menos un valor `SYNTHETIC` incluye `data_mode` `synthetic` o `mixed` y la UI muestra el banner **"Datos sintéticos — no representan la parcela real"**.
- `twin_level` con datos sintéticos = `DIGITAL_MODEL` (nunca "gemelo").
- Prohibido mezclar en silencio: si un puerto cae a sintético por falta de dato real, va en `warnings`.

## Cómo se reemplaza

Se cambia el adaptador, no el motor: `AGROX_DATA_MODE=real` (o override por puerto). Requisitos y checklist: [roadmap](../05-development/roadmap.md) → "Criterios para sustituir sintético por real". Los generadores **se quedan** en el repo para tests y fixtures.
