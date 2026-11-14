"""USGS NWIS: valores diarios de caudal (00060) y nivel freático (72019) del condado, y sus estaciones. Sin llave.
Se pide por condado y no por bbox: en 10x10 km casi nunca hay una estación."""


def links(session, src):
    a = src["area"]
    county = a["county_fips"]
    out = [{"url": "https://waterservices.usgs.gov/nwis/dv/", "name": f"nwis_{label}.rdb",
            "params": {"format": "rdb", "countyCd": county, "startDT": a["start"], "endDT": a["end"], "parameterCd": code}}
           for code, label in [("00060", "caudal"), ("72019", "nivel_freatico")]]
    out.append({"url": "https://waterservices.usgs.gov/nwis/site/", "name": "nwis_estaciones.rdb",
                "params": {"format": "rdb", "countyCd": county, "siteStatus": "all"}})
    return out
