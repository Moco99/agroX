"""FAO GAEZ v4: índice de aptitud por cultivo (temporal, altos insumos, clima 1981-2010). GeoTIFF global ~9 km. Sin llave."""

SERVICE = "https://gaez-services.fao.org/server/rest/services/res05/ImageServer/query"


def links(session, src):
    crops = ",".join(f"'{c}'" for c in src["crops"])
    where = (f"crop IN ({crops}) AND year='1981-2010' AND sub_theme_name='Suitability Index' "
             "AND water_supply='Rainfed' AND input_level='High' AND name LIKE 'suHr_%'")
    r = session.get(SERVICE, params={"where": where, "outFields": "name,download_url", "returnGeometry": "false", "f": "json"},
                    timeout=60)
    r.raise_for_status()
    return [{"url": f["attributes"]["download_url"], "name": f["attributes"]["name"] + ".tif"} for f in r.json()["features"]]
