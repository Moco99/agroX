"""Suelos NRCS: SSURGO del condado y STATSGO2 del estado; son los mismos zips que da Web Soil Survey. Sin llave.

La fecha que lleva el nombre del zip sale de Soil Data Access (sacatalog.saverest).
"""
from datetime import datetime

WSS = "https://websoilsurvey.sc.egov.usda.gov/DSD/Download/Cache"


def _date(session, areasymbol):
    r = session.post("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", timeout=60,
                     json={"query": f"SELECT saverest FROM sacatalog WHERE areasymbol = '{areasymbol}'", "format": "JSON"})
    r.raise_for_status()
    raw = r.json()["Table"][0][0]  # p. ej. "9/8/2026 7:01:27 PM"
    return datetime.strptime(raw.split()[0], "%m/%d/%Y").strftime("%Y-%m-%d")


def links(session, src):
    a = src["area"]
    ssa, st = a["ssurgo_area"], a["state"]
    return [{"url": f"{WSS}/SSA/wss_SSA_{ssa}_[{_date(session, ssa)}].zip", "name": f"ssurgo_{ssa}.zip"},
            {"url": f"{WSS}/STATSGO2/wss_gsmsoil_{st}_[{_date(session, 'US')}].zip", "name": f"statsgo2_{st}.zip"}]
