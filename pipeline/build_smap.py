"""Daily SMAP L3 (SPL3SMP_E, 9 km) surface soil moisture at the farm pixel -> derived/obs/smap_<site>.csv.

Each subsetted granule holds a 2x3 EASE2 window; we pick the cell whose centre is
nearest to the farm centroid, prefer the AM retrieval and fall back to PM. The
retrieval quality flag is exported as-is (bit 0 == 0 means "recommended quality").
SMAP is regional context (~5 cm depth, 9 km), never a field sensor: the backend
labels it accordingly.
"""

from __future__ import annotations

import json
import re

import netCDF4
import numpy as np

from pipeline.common import DERIVED_DIR, FARM_ID, RAW_DIR, SITE_ID, register_artifact, relative_to_derived, write_json

SMAP_DIR = RAW_DIR / "smap"
PARCEL_PATH = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
GROUPS = {"AM": "Soil_Moisture_Retrieval_Data_AM", "PM": "Soil_Moisture_Retrieval_Data_PM"}


def farm_centroid() -> tuple[float, float]:
    parcel = json.loads(PARCEL_PATH.read_text())
    farm = next(f for f in parcel["features"] if f["properties"]["feature_kind"] == "farm")
    c = farm["properties"]["centroid"]
    return float(c["lat"]), float(c["lon"])


def read_cell(
    ds: netCDF4.Dataset, group: str, lat0: float, lon0: float
) -> tuple[float | None, int | None, float, float]:
    g = ds.groups[group]
    suffix = "_pm" if group.endswith("PM") else ""
    lat = np.ma.filled(g.variables[f"latitude{suffix}"][:], np.nan)
    lon = np.ma.filled(g.variables[f"longitude{suffix}"][:], np.nan)
    sm = g.variables[f"soil_moisture{suffix}"][:]
    flag = g.variables[f"retrieval_qual_flag{suffix}"][:]
    # Lat/lon can be masked where no retrieval exists; use the centroid-nearest valid geolocation
    d = (lat - lat0) ** 2 + (lon - lon0) ** 2
    d = np.where(np.isnan(d), np.inf, d)
    if not np.isfinite(d).any():
        return None, None, float("nan"), float("nan")
    r, c = np.unravel_index(int(np.argmin(d)), d.shape)
    value = None if np.ma.is_masked(sm[r, c]) else float(sm[r, c])
    qflag = None if np.ma.is_masked(flag[r, c]) else int(flag[r, c])
    return value, qflag, float(lat[r, c]), float(lon[r, c])


def build() -> None:
    lat0, lon0 = farm_centroid()
    rows = []
    cell_lat = cell_lon = float("nan")
    for path in sorted(SMAP_DIR.glob("*.nc4")):
        m = re.search(r"_(\d{8})_", path.name)
        if not m:
            continue
        d = m.group(1)
        date = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        try:
            ds = netCDF4.Dataset(path)
        except OSError:
            rows.append({"date": date, "soil_moisture": None, "pass": None, "qual_flag": None, "note": "unreadable"})
            continue
        try:
            chosen = None
            for pass_id, group in GROUPS.items():
                if group not in ds.groups:
                    continue
                value, qflag, clat, clon = read_cell(ds, group, lat0, lon0)
                if value is not None:
                    chosen = (value, pass_id, qflag)
                    if clat == clat:
                        cell_lat, cell_lon = clat, clon
                    break
        finally:
            ds.close()
        if chosen is None:
            rows.append({"date": date, "soil_moisture": None, "pass": None, "qual_flag": None, "note": "no_retrieval"})
        else:
            rows.append(
                {
                    "date": date,
                    "soil_moisture": round(chosen[0], 4),
                    "pass": chosen[1],
                    "qual_flag": chosen[2],
                    "note": "",
                }
            )
    out_path = DERIVED_DIR / "obs" / f"smap_{SITE_ID}.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as fh:
        fh.write("date,soil_moisture,pass,qual_flag,note\n")
        for r in rows:
            sm = "" if r["soil_moisture"] is None else r["soil_moisture"]
            fh.write(
                f"{r['date']},{sm},{r['pass'] or ''},{'' if r['qual_flag'] is None else r['qual_flag']},{r['note']}\n"
            )
    n_valid = sum(1 for r in rows if r["soil_moisture"] is not None)
    meta = {
        "files": [relative_to_derived(out_path)],
        "data_state": "MEASURED",
        "source_id": "smap",
        "source": "SMAP L3 Radiometer Enhanced 9 km daily (SPL3SMP_E), NASA NSIDC via Harmony subset",
        "resolution": "9 km EASE2 cell; ~5 cm surface layer",
        "cell": {"lat": cell_lat, "lon": cell_lon},
        "period": {
            "start": rows[0]["date"],
            "end": rows[-1]["date"],
            "days": len(rows),
            "days_with_retrieval": n_valid,
        },
        "units": {"soil_moisture": "m3/m3"},
        "method": "nearest EASE2 cell to farm centroid; AM retrieval preferred, PM fallback; qual_flag raw",
        "note": "Regional context only (not a field sensor); gaps on frozen soil, dense vegetation or orbit gaps.",
    }
    meta_path = DERIVED_DIR / "obs" / f"smap_{SITE_ID}.meta.json"
    write_json(meta_path, meta)
    register_artifact("obs_smap", {**meta, "files": [relative_to_derived(out_path), relative_to_derived(meta_path)]})
    print(f"[smap] days={len(rows)} with_retrieval={n_valid} cell=({cell_lat:.3f},{cell_lon:.3f})")


if __name__ == "__main__":
    build()
