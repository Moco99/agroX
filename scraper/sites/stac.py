"""Imágenes de satélite vía Microsoft Planetary Computer (catálogo STAC). Sin llave.

Busca escenas que tocan el área y baja cada banda ya recortada al bbox (GeoTIFF),
así no hay que bajar escenas completas de cientos de MB.
Lo usan: sentinel2, landsat, modis_ndvi, naip, srtm (ver sources.json).
"""

PC = "https://planetarycomputer.microsoft.com/api"


def links(session, src):
    a = src["area"]
    body = {"collections": [src["collection"]], "bbox": a["bbox"], "limit": src.get("max_items", 5),
            "sortby": [{"field": "datetime", "direction": "desc"}]}
    if src.get("datetime"):  # p. ej. solo temporada de cultivo
        body["datetime"] = src["datetime"]
    elif not src.get("all_dates"):
        body["datetime"] = f"{a['start']}T00:00:00Z/{a['end']}T23:59:59Z"
    if src.get("query"):
        body["query"] = src["query"]
    r = session.post(f"{PC}/stac/v1/search", json=body, timeout=60)
    r.raise_for_status()
    bbox = ",".join(str(v) for v in a["bbox"])
    out = []
    for item in r.json()["features"]:
        for asset in src["assets"]:
            out.append({"url": f"{PC}/data/v1/item/bbox/{bbox}.tif", "name": f"{item['id']}_{asset}.tif",
                        "params": {"collection": src["collection"], "item": item["id"], "assets": asset,
                                   "max_size": src.get("max_size", 1024)}})
    return out
