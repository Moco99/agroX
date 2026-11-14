"""USDA NASS QuickStats: estadísticas agrícolas (rendimientos, superficie sembrada...). https://quickstats.nass.usda.gov/api
Cada consulta devuelve máximo 50,000 filas; por eso se parte en varias."""
from common import need

API = "https://quickstats.nass.usda.gov/api/api_GET/"


def links(session, src):
    key = need("NASS_API_KEY", "gratis e inmediata en https://quickstats.nass.usda.gov/api")
    a = src["area"]
    base = {"key": key, "format": "CSV", "source_desc": "SURVEY", "sector_desc": "CROPS",
            "state_alpha": a["state"], "year__GE": src.get("since", 2000)}
    queries = {
        "nass_condado_cultivos.csv": {"agg_level_desc": "COUNTY", "county_name": a["county_name"]},
        "nass_estado_rendimiento.csv": {"agg_level_desc": "STATE", "statisticcat_desc": "YIELD"},
        "nass_estado_sembrado.csv": {"agg_level_desc": "STATE", "statisticcat_desc": "AREA PLANTED"},
    }
    return [{"url": API, "name": name, "params": {**base, **q}} for name, q in queries.items()]
