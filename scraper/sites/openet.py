"""OpenET: evapotranspiración mensual en el centro del área. Solo cubre estados del oeste de EE.UU.
Esquema verificado en https://openet-api.org/openapi.json. NO PROBADO con llave."""
from common import center, need


def links(session, src):
    key = need("OPENET_API_KEY", "gratis en https://etdata.org, sección API")
    a = src["area"]
    lon, lat = center(a)
    return [{"url": "https://openet-api.org/raster/timeseries/point", "name": f"openet_{var}_mensual.csv",
             "headers": {"Authorization": key},
             "json": {"date_range": [a["start"], a["end"]], "interval": "monthly", "geometry": [lon, lat],
                      "model": "ensemble", "variable": var, "reference_et": "gridmet", "units": "mm", "file_format": "csv"}}
            for var in ("et", "eto")]
