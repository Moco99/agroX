"""NASA Harmony: recorta los datos de Earthdata a tu área en los servidores de NASA antes de bajarlos.

Para productos globales (SMAP, IMERG, GEDI) baja KB o pocos MB en vez de cientos de MB por archivo.
Mismo token que earthdata.py: EARTHDATA_TOKEN en .env. https://harmony.earthdata.nasa.gov/docs
"""
from pathlib import Path
from urllib.parse import urljoin, urlparse

from common import need, poll

H = "https://harmony.earthdata.nasa.gov"
CMR = "https://cmr.earthdata.nasa.gov/search"


def _collection_id(session, src):
    params = {"short_name": src["short_name"], "page_size": 50}
    if src.get("version"):
        params["version"] = src["version"]
    r = session.get(f"{CMR}/collections.json", params=params, timeout=60)
    r.raise_for_status()
    entries = r.json()["feed"]["entry"]
    if not entries:
        raise RuntimeError(f"CMR no conoce la colección {src['short_name']}")
    return max(entries, key=lambda c: c["version_id"])["id"]


def links(session, src):
    token = need("EARTHDATA_TOKEN", "gratis en https://urs.earthdata.nasa.gov, menú Generate Token")
    auth = {"Authorization": f"Bearer {token}"}
    a = src["area"]
    w, s, e, n = a["bbox"]
    params = [("subset", f"lat({s}:{n})"), ("subset", f"lon({w}:{e})"),
              ("subset", f'time("{a["start"]}T00:00:00Z":"{a["end"]}T23:59:59Z")'),
              ("format", src.get("format", "application/x-netcdf4")),
              ("skipPreview", "true")]  # sin esto Harmony pausa los trabajos grandes esperando confirmación
    if src.get("max_granules"):
        params.append(("maxResults", src["max_granules"]))
    url = f"{H}/{_collection_id(session, src)}/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset"
    r = session.get(url, params=params, headers=auth, timeout=120, allow_redirects=False)
    r.raise_for_status()
    loc = r.headers.get("Location", "")
    if r.is_redirect and "/jobs/" not in loc:
        # Pedido de un solo archivo: Harmony responde directo con el enlace firmado al resultado.
        return [{"url": loc, "name": Path(urlparse(loc).path).name}]
    job = (session.get(urljoin(H, loc), headers=auth, timeout=60) if loc else r).json()["jobID"]
    print(f"   trabajo Harmony {job}, recortando en servidores de NASA...")

    def done():
        st = session.get(f"{H}/jobs/{job}", params={"limit": 2000}, headers=auth, timeout=60).json()
        if st["status"] in ("failed", "canceled"):
            raise RuntimeError(f"Harmony {job}: {st.get('message')}")
        if st["status"] == "paused":
            session.get(f"{H}/jobs/{job}/resume", headers=auth, timeout=60)
        return st if st["status"] in ("successful", "complete_with_errors") else None

    st = poll(done, every=10, timeout=3600)
    if st["status"] == "complete_with_errors":
        print(f"   aviso: {st.get('message')}")
    return [{"url": l["href"], "name": l["title"], "headers": auth} for l in st["links"] if l.get("rel") == "data"]
