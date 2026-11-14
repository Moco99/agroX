"""LANDFIRE (USFS/USGS): vegetación y pendiente recortadas al área, vía LANDFIRE Product Service.

Funciona por trabajos: se pide, se espera y se baja un zip. El servicio exige un correo (LANDFIRE_EMAIL).
Rutas tomadas de la página oficial https://lfps.usgs.gov (submit y status). NO PROBADO de punta a punta.
"""
import json
import re

from common import need, poll

API = "https://lfps.usgs.gov/api/job"


def links(session, src):
    email = need("LANDFIRE_EMAIL", "el correo de quien pide los datos")
    w, s, e, n = src["area"]["bbox"]
    r = session.post(f"{API}/submit", timeout=60, data=json.dumps(
        {"Layer_List": ";".join(src["layers"]), "Area_of_Interest": f"{w} {s} {e} {n}", "Email": email}))
    r.raise_for_status()
    job = r.json()["jobId"]
    print(f"   trabajo LANDFIRE {job} en cola...")

    def status():
        st = session.get(f"{API}/status/", params={"JobId": job}, timeout=60).json()
        text = json.dumps(st)
        if re.search(r"fail|error", str(st.get("status", "")), re.I):
            raise RuntimeError(f"LANDFIRE {job}: {text[:300]}")
        m = re.search(r'"(https://[^"]+\.zip)"', text)
        return m.group(1) if m else None

    return [{"url": poll(status, every=10), "name": f"landfire_{job}.zip"}]
