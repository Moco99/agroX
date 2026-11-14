"""PRISM (Oregon State): clima mensual 4 km de EE.UU. continental. Sin llave.
PRISM limita cuántas veces se baja el mismo archivo al día; el script nunca repite lo ya descargado."""
from common import months


def links(session, src):
    return [{"url": f"https://services.nacse.org/prism/data/get/us/4km/{v}/{ym}", "name": f"prism_{v}_{ym}.zip"}
            for v in src["vars"] for ym in months(src["area"])]
