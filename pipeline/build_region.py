"""Regional context for the "Analisis de region" panel: MODIS NDVI over the whole pilot area + FAO GAEZ suitability.

Outputs (derived/region/):
  ndvi_modis_region_story_pilot.csv   date, ndvi_mean, ndvi_p10, ndvi_p90, n_pixels (Terra/Aqua averaged per date)
  gaez_suitability_story_pilot.json   FAO GAEZ v4 suHr index sampled at the pilot point, per crop

The period summary itself (NDVI, precipitation, temperature, radiation and deltas) is computed by the backend
region service from these files plus the POWER series; story_summary.json is its output for the default season.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from app.storage.factory import get_store
from pipeline.common import (
    DERIVED_DIR,
    PILOT_BBOX,
    POWER_LAT,
    POWER_LON,
    register_artifact,
    relative_to_derived,
    write_json,
)

MODIS_SCALE = 0.0001
MODIS_FILL = -3000
GAEZ_CROPS = {
    "mze": "maize",
    "soy": "soybean",
    "whe": "wheat",
    "alf": "alfalfa",
    "oat": "oat",
    "rye": "rye",
    "srg": "sorghum",
}
# GAEZ v4 suitability index (SI) runs 0-10000 (= 0-100 %).
# Values slightly above 10000 exist in the raster and are clipped.
GAEZ_SI_MAX = 10000


def _modis_date(name: str) -> str:
    m = re.match(r"M[OY]D13Q1\.A(\d{4})(\d{3})\.", name)
    if not m:
        raise ValueError(name)
    return (datetime(int(m.group(1)), 1, 1) + timedelta(days=int(m.group(2)) - 1)).strftime("%Y-%m-%d")


def build_modis_region() -> dict[str, Any]:
    store = get_store()
    keys = sorted(o.key for o in store.list_objects("modis_ndvi/") if o.key.endswith(".tif"))
    per_date: dict[str, list[np.ndarray]] = {}
    for key in keys:
        date = _modis_date(key.rsplit("/", 1)[-1])
        with store.open_raster(key) as src:
            data = src.read(1).astype(np.float64)
        vals = data[data != MODIS_FILL] * MODIS_SCALE
        if vals.size:
            per_date.setdefault(date, []).append(vals)
    rows = []
    for date in sorted(per_date):
        vals = np.concatenate(per_date[date])
        rows.append(
            (
                date,
                round(float(vals.mean()), 4),
                round(float(np.percentile(vals, 10)), 4),
                round(float(np.percentile(vals, 90)), 4),
                int(vals.size),
            )
        )
    out = DERIVED_DIR / "region" / "ndvi_modis_region_story_pilot.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fh:
        fh.write("date,ndvi_mean,ndvi_p10,ndvi_p90,n_pixels\n")
        for r in rows:
            fh.write(",".join(str(v) for v in r) + "\n")
    print(f"[region] MODIS region composites={len(rows)} {rows[0][0]}..{rows[-1][0]}")
    return {
        "files": [relative_to_derived(out)],
        "data_state": "MEASURED",
        "source_id": "modis_ndvi",
        "source": "MODIS MOD13Q1 + MYD13Q1 v061 NDVI 250 m 16-day, mean over the whole pilot bbox",
        "resolution": "250 m",
        "method": "scale 0.0001, fill -3000 dropped; mean/p10/p90 over every pixel of the pilot bbox; Terra and Aqua "
        "composites sharing a start date are pooled",
        "bbox": list(PILOT_BBOX),
    }


def build_gaez() -> dict[str, Any]:
    store = get_store()
    crops: dict[str, Any] = {}
    for code, crop in GAEZ_CROPS.items():
        key = f"gaez/suHr_{code}.tif"
        if not store.exists(key):
            continue
        with store.open_raster(key) as src:
            value = next(iter(src.sample([(POWER_LON, POWER_LAT)])))[0]
            nodata = src.nodata
        if nodata is not None and value == nodata or value < 0:
            crops[crop] = {"index": None, "note": "no data at the pilot point"}
            continue
        index = min(int(value), GAEZ_SI_MAX)
        crops[crop] = {"index_raw": int(value), "index": index, "index_pct": round(index / 100, 1)}
    payload = {
        "point": {"lat": POWER_LAT, "lon": POWER_LON},
        "variable": "suHr",
        "label": "Indice de aptitud agroclimatica (no es una probabilidad)",
        "interpretation": "FAO GAEZ v4 'suHr': suitability index for rain-fed (r) cropping at high (H) input level, "
        "scale 0-10000 (= 0-100 %), climate period 1981-2010, ~9 km (5 arc-minute) cells. It ranks the "
        "agro-climatic fit of a crop at the cell; it is not a yield forecast nor a probability of success, and it "
        "does not see this farm's soil or management.",
        "classes_note": "GAEZ publishes qualitative SI classes (very suitable ... not suitable); thresholds TBD "
        "(verificar fuente: FAO GAEZ v4 documentation) so only the numeric index is exposed.",
        "source": "FAO/IIASA GAEZ v4, theme 4 Suitability and Attainable Yield (suHr rasters)",
        "period": "1981-2010",
        "resolution": "5 arc-minute (~9 km)",
        "data_state": "ESTIMATED",
        "crops": crops,
    }
    out = DERIVED_DIR / "region" / "gaez_suitability_story_pilot.json"
    write_json(out, payload)
    print(f"[region] GAEZ {[(c, v.get('index')) for c, v in crops.items()]}")
    return {
        "files": [relative_to_derived(out)],
        "data_state": "ESTIMATED",
        "source_id": "gaez",
        "source": payload["source"],
        "resolution": payload["resolution"],
        "method": "value of the 5 arc-minute cell containing the pilot point, clipped to 10000",
    }


def build() -> None:
    register_artifact("region_ndvi_modis", build_modis_region())
    register_artifact("region_gaez", build_gaez())


if __name__ == "__main__":
    build()
