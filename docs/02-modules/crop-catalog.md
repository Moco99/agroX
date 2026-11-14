# Crop Catalog (`crop_catalog`)

> TL;DR: Base de conocimiento versionada (`catalog_v1`) con parámetros por cultivo para el gemelo y el Rotation Engine. Piloto: corn, soybean y una cobertura. Cada valor con fuente y `verificado`.
> Depende de: [data-contracts](../01-architecture/data-contracts.md)
> Estado: draft (todos los valores numéricos TBD)
> Última revisión: 2026-11-14

Endpoint: `GET /api/crops`. Puerto: `CropCatalogProvider`.

## Campos por cultivo

| Campo | Tipo | Unidad | Uso |
|---|---|---|---|
| `crop_id` | str | — | ID canónico ([glossary](../00-overview/glossary.md)) |
| `name_es` / `name_en` | str | — | UI |
| `family` | str | — | Regla R1 (familia botánica) |
| `crop_type` | `CropType` | — | `CASH_CROP` / `COVER_CROP` |
| `cycle_days` | int | días | Regla R4, fenología por días |
| `planting_window` | `{start_mmdd, end_mmdd}` | — | Regla R3 |
| `t_min`, `t_opt`, `t_max` | float | °C | Indicador C, días fuera de rango |
| `t_base_gdd` (y `t_cap_gdd` opcional) | float | °C | GDD (modelo 5) |
| `gdd_stages` | `{initial, development, mid, late}` | °C·día | Etapa por GDD |
| `stage_lengths_days` | `{initial, development, mid, late}` | días | Alternativa FAO-56 por días |
| `water_need_mm` | float | mm/ciclo | Contexto |
| `kc_ini`, `kc_mid`, `kc_end` | float | — | Modelo 3 |
| `root_depth_min_m`, `root_depth_max_m` | float | m | Balance hídrico |
| `depletion_fraction_p` | float | — | RAW = p·TAW |
| `fixes_nitrogen` | bool | — | Regla R2 |
| `sources` | list[str] | — | Referencias verificables por campo |
| `verified` | bool | — | `false` hasta revisar fuentes |

Nombre del campo en código: `verified` (inglés); en prosa "verificado".

## Piloto `catalog_v1`

| crop_id | family | type | Valores numéricos |
|---|---|---|---|
| `corn` | Poaceae | CASH_CROP | TBD (verificar fuente: FAO-56 tablas 11/12/22, extensión Iowa State) |
| `soybean` | Fabaceae | CASH_CROP | TBD (verificar fuente: FAO-56, extensión Iowa State) |
| `cereal_rye` u `oat` (O-3) | Poaceae | COVER_CROP | TBD (verificar fuente: FAO-56 / EcoCrop / SARE / USDA-NRCS) |

Futuro (Veracruz): `common_bean` (Fabaceae), ver ADR-001.

## Archivo (`derived/catalog/catalog_v1.json`)

```json
{
  "catalog_version": "catalog_v1",
  "crops": [
    {
      "crop_id": "soybean", "name_es": "Soya", "name_en": "Soybean", "family": "Fabaceae",
      "crop_type": "CASH_CROP", "fixes_nitrogen": true,
      "kc_ini": null, "kc_mid": null, "kc_end": null,
      "sources": [], "verified": false
    }
  ]
}
```
`null` = TBD. El modelo Pydantic acepta `null` solo si `verified = false`; un `null` en un campo que el motor necesita produce `warnings` y `RecommendationStatus.PRELIMINARY`.

## Modo sintético

`SyntheticCropCatalogProvider` devuelve parámetros **provisionales, sintéticos, no científicos**, con `data_state = SYNTHETIC`, para que el motor corra en F1. Ver [synthetic-data](../04-data/synthetic-data.md).

## Reglas

- No inventar valores: todo número real lleva al menos una entrada en `sources`.
- Cambiar un valor verificado ⇒ nueva versión (`catalog_v2`) o PR revisado por Opus.
- GAEZ (aptitud por cultivo, en `data/raw/gaez/`) es contexto de aptitud regional, no parámetro del catálogo.

Builder del catálogo verificado: Opus (búsqueda de fuentes) con revisión de Fable (honestidad). Schema y loader: Sonnet.
