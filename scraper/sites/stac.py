"""Imágenes de satélite vía Microsoft Planetary Computer (catálogo STAC). Sin llave.

Busca escenas que tocan el área y baja cada banda ya recortada al bbox (GeoTIFF),
así no hay que bajar escenas completas de cientos de MB.
Lo usan: sentinel2, landsat, modis_ndvi, naip, srtm (ver sources.json).
"""

PC = "https://planetarycomputer.microsoft.com/api"


def links(session, src):
    """`datetime` puede ser un rango o una lista de rangos (p. ej. una temporada por año);
    `max_items` aplica a cada rango, así cada temporada trae sus escenas y no solo las más recientes."""
    a = src["area"]
    rangos = src.get("datetime") or (None if src.get("all_dates") else f"{a['start']}T00:00:00Z/{a['end']}T23:59:59Z")
    rangos = rangos if isinstance(rangos, list) else [rangos]
    bbox = ",".join(str(v) for v in a["bbox"])
    out = []
    for rango in rangos:
        body = {"collections": [src["collection"]], "bbox": a["bbox"], "limit": src.get("max_items", 5),
                "sortby": [{"field": "datetime", "direction": "desc"}]}
        if rango:
            body["datetime"] = rango
        if src.get("query"):
            body["query"] = src["query"]
        r = session.post(f"{PC}/stac/v1/search", json=body, timeout=60)
        r.raise_for_status()
        for item in r.json()["features"]:
            for asset in src["assets"]:
                out.append({"url": f"{PC}/data/v1/item/bbox/{bbox}.tif", "name": f"{item['id']}_{asset}.tif",
                            "params": {"collection": src["collection"], "item": item["id"], "assets": asset,
                                       "max_size": src.get("max_size", 1024)}})
    return out
