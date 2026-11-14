"""Datos de NASA Earthdata (SMAP, IMERG, ECOSTRESS, VIIRS, NLDAS, GLDAS, GEDI...).

Busca archivos ("granules") en el catálogo CMR, que es público, filtrando por área y fechas.
Descargarlos pide un token gratis de Earthdata Login: EARTHDATA_TOKEN en .env
(https://urs.earthdata.nasa.gov -> Generate Token).
"""
import re
from pathlib import Path

from common import need

CMR = "https://cmr.earthdata.nasa.gov/search"
DATA_REL = "http://esipfed.org/ns/fedsearch/1.1/data#"


def _latest_version(session, short_name):
    r = session.get(f"{CMR}/collections.json", params={"short_name": short_name, "page_size": 50}, timeout=60)
    r.raise_for_status()
    versions = [c["version_id"] for c in r.json()["feed"]["entry"]]
    if not versions:
        raise RuntimeError(f"CMR no conoce la colección {short_name}")
    return max(versions, key=lambda v: [int(x) if x.isdigit() else x for x in re.split(r"[._]", v)])


def links(session, src):
    a = src["area"]
    version = src.get("version") or _latest_version(session, src["short_name"])
    r = session.get(f"{CMR}/granules.json", timeout=60, params={
        "short_name": src["short_name"], "version": version,
        "temporal": f"{a['start']}T00:00:00Z,{a['end']}T23:59:59Z",
        "bounding_box": ",".join(str(v) for v in a["bbox"]),
        "page_size": src.get("max_granules", 10), "sort_key": "-start_date"})
    r.raise_for_status()
    urls = [l["href"] for g in r.json()["feed"]["entry"] for l in g.get("links", [])
            if l.get("rel") == DATA_REL and l["href"].startswith("https") and not l.get("inherited")]
    if src.get("pattern"):
        urls = [u for u in urls if re.search(src["pattern"], u)]
    print(f"   CMR: {len(urls)} archivos de {src['short_name']} v{version}")
    token = need("EARTHDATA_TOKEN", "gratis en https://urs.earthdata.nasa.gov, menú Generate Token")
    return [{"url": u, "name": Path(u).name, "headers": {"Authorization": f"Bearer {token}"}} for u in urls]
