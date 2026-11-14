"""CropScape (USDA CDL): GeoTIFF de cultivos 30 m del condado, por año. Sin llave."""
import re


def links(session, src):
    out = []
    for year in src["years"]:
        r = session.get("https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile",
                        params={"year": year, "fips": src["area"]["county_fips"]}, timeout=120)
        r.raise_for_status()
        m = re.search(r"<returnURL>(.*?)</returnURL>", r.text)
        if not m:
            raise RuntimeError(f"CDL {year}: respuesta sin returnURL: {r.text[:200]}")
        out.append({"url": m.group(1), "name": f"CDL_{year}_{src['area']['county_fips']}.tif"})
    return out
