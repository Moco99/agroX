"""USDA AMS Market News (MyMarketNews API): precios históricos de reportes de mercado, en JSON.
Los "slugs" son los números de reporte (2850 = Iowa Daily Cash Grain Bids); se buscan en https://mymarketnews.ams.usda.gov
NO PROBADO con llave: la API devolvió 403 sin ella, como esperábamos."""
import base64

from common import need

API = "https://marsapi.ams.usda.gov/services/v1.2/reports"


def links(session, src):
    key = need("AMS_API_KEY", "gratis creando cuenta en https://mymarketnews.ams.usda.gov")
    auth = base64.b64encode(f"{key}:".encode()).decode()  # la llave va como usuario, sin contraseña
    a = src["area"]
    us = lambda d: f"{d[5:7]}/{d[8:10]}/{d[:4]}"
    return [{"url": f"{API}/{slug}", "name": f"ams_{slug}.json", "headers": {"Authorization": f"Basic {auth}"},
             "params": {"q": f"report_begin_date={us(a['start'])}:{us(a['end'])}"}}
            for slug in src["slugs"]]
