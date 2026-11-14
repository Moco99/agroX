"""NLCD (USGS/MRLC): cobertura del suelo 30 m recortada al área vía WCS. Sin llave."""


def links(session, src):
    w, s, e, n = src["area"]["bbox"]
    return [{"url": "https://www.mrlc.gov/geoserver/ows", "name": cov.removeprefix("mrlc_download__") + ".tif",
             "params": [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("coverageId", cov),
                        ("subset", f"Lat({s},{n})"), ("subset", f"Long({w},{e})"),
                        ("subsettingCrs", "http://www.opengis.net/def/crs/EPSG/0/4326"), ("format", "image/tiff")]}
            for cov in src["coverages"]]
