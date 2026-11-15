"""SoilProfile per management zone from the SSURGO county export -> derived/soil/<farm_id>.json.

Column names come from `tabular/mstabcol.txt` inside the zip (the official SSURGO
metadata table), so no column order is assumed from memory. For each zone we take
the map unit with the largest overlap area (soilmu_a shapefile, WGS84), then the
dominant component (max comppct_r) and its horizons. AWC is depth-weighted to the
crop root depth from chorizon.awc_r; muaggatt aggregates are kept as cross-check.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from typing import Any

import shapefile
from shapely.geometry import Polygon, shape

from pipeline.common import DERIVED_DIR, FARM_ID, RAW_DIR, register_artifact, relative_to_derived, sha256_of, write_json

SSURGO_ZIP = RAW_DIR / "ssurgo" / "ssurgo_IA169.zip"
AREA = "IA169"
PARCEL_PATH = DERIVED_DIR / "parcel" / f"{FARM_ID}.geojson"
# Profile depth used for the exposed AWC (mm/m): FAO-56 works in mm per metre of root zone
AWC_PROFILE_DEPTH_CM = 100.0

# ─────────────────────────────────────────
# Section: Tabular readers
# ─────────────────────────────────────────


def read_columns(z: zipfile.ZipFile) -> dict[str, list[str]]:
    cols: dict[str, list[tuple[int, str]]] = defaultdict(list)
    text = z.read(f"{AREA}/tabular/mstabcol.txt").decode("latin-1")
    for row in csv.reader(io.StringIO(text), delimiter="|", quotechar='"'):
        cols[row[0]].append((int(row[1]), row[2]))
    return {table: [name for _, name in sorted(v)] for table, v in cols.items()}


def read_table(z: zipfile.ZipFile, file_name: str, table: str, columns: dict[str, list[str]]) -> list[dict[str, str]]:
    text = z.read(f"{AREA}/tabular/{file_name}.txt").decode("latin-1")
    names = columns[table]
    rows = []
    for row in csv.reader(io.StringIO(text), delimiter="|", quotechar='"'):
        if not row:
            continue
        rows.append(dict(zip(names, row, strict=False)))
    return rows


def to_float(value: str | None) -> float | None:
    if value is None or value.strip() == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


# ─────────────────────────────────────────
# Section: Spatial overlap
# ─────────────────────────────────────────


def dominant_mukeys(zones: list[dict[str, Any]], z: zipfile.ZipFile) -> dict[str, list[tuple[str, float]]]:
    """Return {zone_id: [(mukey, overlap_fraction), ...]} sorted by overlap."""
    files = {ext: io.BytesIO(z.read(f"{AREA}/spatial/soilmu_a_ia169.{ext}")) for ext in ("shp", "shx", "dbf")}
    reader = shapefile.Reader(shp=files["shp"], shx=files["shx"], dbf=files["dbf"])
    field_names = [f[0] for f in reader.fields[1:]]
    mukey_idx = field_names.index("MUKEY")
    zone_polys = {zf["properties"]["zone_id"]: Polygon(zf["geometry"]["coordinates"][0]) for zf in zones}
    overlaps: dict[str, dict[str, float]] = {zid: defaultdict(float) for zid in zone_polys}
    union_bounds = [p.bounds for p in zone_polys.values()]
    minx = min(b[0] for b in union_bounds)
    miny = min(b[1] for b in union_bounds)
    maxx = max(b[2] for b in union_bounds)
    maxy = max(b[3] for b in union_bounds)
    for sr in reader.iterShapeRecords():
        bx0, by0, bx1, by1 = sr.shape.bbox
        if bx1 < minx or bx0 > maxx or by1 < miny or by0 > maxy:
            continue
        geom = shape(sr.shape.__geo_interface__)
        if not geom.is_valid:
            geom = geom.buffer(0)
        mukey = str(sr.record[mukey_idx])
        for zid, poly in zone_polys.items():
            inter = poly.intersection(geom)
            if not inter.is_empty:
                overlaps[zid][mukey] += inter.area / poly.area
    return {zid: sorted(d.items(), key=lambda kv: kv[1], reverse=True) for zid, d in overlaps.items()}


# ─────────────────────────────────────────
# Section: Profile assembly
# ─────────────────────────────────────────


def profile_for_mukey(mukey: str, tables: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    mu = next((m for m in tables["mapunit"] if m["mukey"] == mukey), None)
    agg = next((m for m in tables["muaggatt"] if m["mukey"] == mukey), None)
    comps = [c for c in tables["component"] if c["mukey"] == mukey]
    comps.sort(key=lambda c: to_float(c["comppct_r"]) or 0.0, reverse=True)
    comp = comps[0] if comps else None
    warnings: list[str] = []
    horizons: list[dict[str, Any]] = []
    awc_weighted: float | None = None
    texture: str | None = None
    if comp is not None:
        hz = [h for h in tables["chorizon"] if h["cokey"] == comp["cokey"]]
        hz.sort(key=lambda h: to_float(h["hzdept_r"]) or 0.0)
        total = 0.0
        covered = 0.0
        for h in hz:
            top = to_float(h["hzdept_r"])
            bottom = to_float(h["hzdepb_r"])
            awc = to_float(h["awc_r"])
            if top is None or bottom is None:
                continue
            tex = next(
                (
                    t["texture"]
                    for t in tables["chtexturegrp"]
                    if t["chkey"] == h["chkey"] and t["rvindicator"] == "Yes"
                ),
                None,
            )
            if texture is None and tex:
                texture = tex
            horizons.append(
                {
                    "name": h["hzname"],
                    "top_cm": top,
                    "bottom_cm": bottom,
                    "awc_cm_per_cm": awc,
                    "texture": tex,
                    "clay_pct": to_float(h["claytotal_r"]),
                    "sand_pct": to_float(h["sandtotal_r"]),
                    "om_pct": to_float(h["om_r"]),
                    "ksat_um_s": to_float(h["ksat_r"]),
                }
            )
            lo, hi = max(top, 0.0), min(bottom, AWC_PROFILE_DEPTH_CM)
            if hi > lo and awc is not None:
                total += awc * (hi - lo)
                covered += hi - lo
        if covered > 0:
            # awc_r is cm/cm; (cm water over covered cm) / covered cm * 1000 mm/m
            awc_weighted = round(total / covered * 1000.0, 1)
            if covered < AWC_PROFILE_DEPTH_CM - 1:
                warnings.append(f"horizons cover only {covered:.0f} of {AWC_PROFILE_DEPTH_CM:.0f} cm")
    else:
        warnings.append("no component rows for map unit")
    restrictive_cm = to_float(agg["brockdepmin"]) if agg else None
    water_table_cm = to_float(agg["wtdepannmin"]) if agg else None
    aws0100 = to_float(agg["aws0100wta"]) if agg else None
    return {
        "mukey": mukey,
        "musym": mu["musym"] if mu else None,
        "map_unit_name": mu["muname"] if mu else None,
        "component_name": comp["compname"] if comp else None,
        "component_pct": to_float(comp["comppct_r"]) if comp else None,
        "taxonomic_class": comp["taxclname"] if comp else None,
        "drainage_class": (comp["drainagecl"] if comp and comp["drainagecl"] else (agg["drclassdcd"] if agg else None)),
        "hydrologic_group": (comp["hydgrp"] if comp and comp["hydgrp"] else (agg["hydgrpdcd"] if agg else None)),
        "texture": texture,
        "awc_mm_per_m": awc_weighted,
        "awc_cross_check_aws0100wta_cm": aws0100,
        "slope_pct_ssurgo": to_float(agg["slopegradwta"]) if agg else None,
        "restrictive_depth_cm": restrictive_cm,
        "water_table_min_depth_cm": water_table_cm,
        "horizons": horizons,
        "warnings": warnings,
    }


def build() -> None:
    import json

    parcel = json.loads(PARCEL_PATH.read_text())
    zones = [f for f in parcel["features"] if f["properties"]["feature_kind"] == "zone"]
    with zipfile.ZipFile(SSURGO_ZIP) as z:
        columns = read_columns(z)
        tables = {
            "mapunit": read_table(z, "mapunit", "mapunit", columns),
            "muaggatt": read_table(z, "muaggatt", "muaggatt", columns),
            "component": read_table(z, "comp", "component", columns),
            "chorizon": read_table(z, "chorizon", "chorizon", columns),
            "chtexturegrp": read_table(z, "chtexgrp", "chtexturegrp", columns),
        }
        overlaps = dominant_mukeys(zones, z)
    out_zones = []
    for zf in zones:
        zid = zf["properties"]["zone_id"]
        ranked = overlaps[zid]
        if not ranked:
            out_zones.append(
                {
                    "zone_id": zid,
                    "data_state": "ESTIMATED",
                    "verified": False,
                    "warnings": ["no SSURGO polygon overlaps zone"],
                    "profile": None,
                    "map_units": [],
                }
            )
            continue
        mukey, frac = ranked[0]
        prof = profile_for_mukey(mukey, tables)
        state = "MEASURED" if prof["awc_mm_per_m"] is not None else "ESTIMATED"
        out_zones.append(
            {
                "zone_id": zid,
                "dominant_overlap_fraction": round(frac, 3),
                "map_units": [{"mukey": k, "fraction": round(v, 3)} for k, v in ranked[:5]],
                "profile": prof,
                "data_state": state,
                "verified": False,
                "warnings": prof["warnings"],
            }
        )
    out = {
        "farm_id": FARM_ID,
        "source": "USDA NRCS SSURGO, Story County IA169 (Web Soil Survey export)",
        "method": "largest-overlap map unit per zone; dominant component by comppct_r; AWC depth-weighted "
        "0-100 cm from chorizon.awc_r (cm/cm) * 1000 -> mm/m; texture from the RV texture group of the top horizon",
        "notes": [
            "SSURGO is a survey product (map-unit scale), not a field measurement; "
            "data_state MEASURED refers to the survey.",
            "verified=false until an agronomist reviews the mapping of SSURGO classes to FAO-56 parameters.",
        ],
        "zones": out_zones,
    }
    out_path = DERIVED_DIR / "soil" / f"{FARM_ID}.json"
    write_json(out_path, out)
    register_artifact(
        "soil_ssurgo",
        {
            "files": [relative_to_derived(out_path)],
            "data_state": "MEASURED",
            "source_id": "ssurgo",
            "resolution": "map unit polygons (1:12,000-1:24,000)",
            "inputs": [{"path": "data/raw/ssurgo/ssurgo_IA169.zip", "sha256": sha256_of(SSURGO_ZIP)}],
        },
    )
    for zz in out_zones:
        p = zz["profile"] or {}
        print(
            f"[soil] {zz['zone_id']} mukey={p.get('mukey')} {p.get('component_name')} awc={p.get('awc_mm_per_m')} mm/m "
            f"tex={p.get('texture')} hyd={p.get('hydrologic_group')} drain={p.get('drainage_class')}"
        )


if __name__ == "__main__":
    build()
