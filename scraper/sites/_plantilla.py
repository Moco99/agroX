"""Plantilla para un sitio que no se resuelve buscando links en el HTML (API, CKAN, paginación, JS).

Copia este archivo como scraper/sites/<id>.py, con el mismo id que en sources.json.
Debe devolver la lista de URLs a descargar; scrape.py se encarga de bajarlas.
"""


def links(session, src):
    # Ejemplo con un portal CKAN (muchos portales de datos abiertos lo usan):
    r = session.get(src["url"], params={"q": "agricultura", "rows": 1000}, timeout=60)
    r.raise_for_status()
    return [res["url"] for ds in r.json()["result"]["results"] for res in ds["resources"]]
