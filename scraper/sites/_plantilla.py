"""Plantilla de conector. Copia como scraper/sites/<id>.py (mismo id que en sources.json).

links(session, src) devuelve lo que hay que descargar: URLs sueltas o dicts con
  url, name (nombre del archivo), params, headers, json (si lo trae, se manda como POST).
src trae el bloque de sources.json y src["area"] (bbox, fechas, condado...).
Si falta una llave: from common import need; need("MI_API_KEY", "dónde sacarla") la salta sin error.
"""


def links(session, src):
    a = src["area"]
    return [{"url": "https://ejemplo.org/api/datos", "params": {"bbox": ",".join(map(str, a["bbox"]))}, "name": "datos.csv"}]
