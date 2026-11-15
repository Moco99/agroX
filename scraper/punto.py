"""Consulta en vivo de cualquier punto del mundo: lo que necesita la app para recomendar rotaciones.

    python scraper/punto.py LAT LON [INICIO FIN]     # p. ej. 30.80 75.55 2023-01-01 2024-12-31

Desde la app:  from punto import consultar;  datos = consultar(30.80, 75.55)

Todo es global y sin llaves. Cada sección se pide en paralelo y, si una falla, las demás siguen.
El resultado se guarda en data/cache/, así que repetir el mismo punto es instantáneo.

Fuentes (todas verificadas por punto en Iowa, Brasil, India y Francia):
  cobertura  ESA WorldCover 2021 (10 m) + Impact Observatory LULC anual 2017-2023 (10 m)   Planetary Computer
  terreno    Copernicus DEM 30 m: elevación y pendiente                                     Planetary Computer
  suelo      SoilGrids 250 m: textura, pH, carbono, nitrógeno, CEC, densidad, 0-30 cm        ISRIC
  clima      NASA POWER diario + normales de 30 años                                        NASA
  vegetacion NDVI de Sentinel-2 (10 m) escena por escena, sin nubes                         Planetary Computer
  aptitud    FAO GAEZ v4: índice de aptitud de 20 cultivos de rotación, temporal y con riego  FAO
"""
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import requests

PC = "https://planetarycomputer.microsoft.com/api"
GAEZ = "https://gaez-services.fao.org/server/rest/services/res05/ImageServer/identify"
CACHE = Path(__file__).parent.parent / "data" / "cache"

# Clases oficiales, leídas de los metadatos de cada colección en Planetary Computer.
WORLDCOVER = {10: "bosque", 20: "matorral", 30: "pastizal", 40: "cultivo", 50: "urbano", 60: "suelo desnudo",
              70: "nieve/hielo", 80: "agua", 90: "humedal", 95: "manglar", 100: "musgo/liquen"}
LULC = {0: "sin dato", 1: "agua", 2: "bosque", 4: "vegetación inundada", 5: "cultivo", 7: "urbano",
        8: "suelo desnudo", 9: "nieve/hielo", 10: "nubes", 11: "pastizal"}
# Códigos GAEZ v4 (consultados en su servicio). Cereales, leguminosas, oleaginosas y otros de rotación.
CULTIVOS = {"mze": "maíz", "whe": "trigo", "brl": "cebada", "oat": "avena", "rye": "centeno", "srg": "sorgo",
            "pml": "mijo perla", "rcw": "arroz inundado", "soy": "soya", "chk": "garbanzo", "pea": "chícharo",
            "phb": "frijol", "grd": "cacahuate", "cow": "caupí", "alf": "alfalfa", "rsd": "colza",
            "sfl": "girasol", "cot": "algodón", "wpo": "papa", "csv": "yuca"}
SUELO = ["clay", "sand", "silt", "soc", "phh2o", "nitrogen", "cec", "bdod"]
SUELO_NOMBRES = {"clay": "arcilla_%", "sand": "arena_%", "silt": "limo_%", "soc": "carbono_organico_g_kg",
                 "phh2o": "ph", "nitrogen": "nitrogeno_g_kg", "cec": "cic_cmol_kg", "bdod": "densidad_kg_dm3"}
CLIMA = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,GWETTOP,GWETROOT"
SCL_MALO = {0, 1, 3, 8, 9, 10, 11}  # Sentinel-2: sin dato, saturado, sombra, nubes, cirros, nieve


def _sesion():
    s = requests.Session()
    s.headers["User-Agent"] = "agroX-hackathon/0.3"
    s.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=32))
    return s


def _items(s, coleccion, lat, lon, fechas=None, limite=1, query=None):
    body = {"collections": [coleccion], "intersects": {"type": "Point", "coordinates": [lon, lat]}, "limit": limite}
    if fechas:
        body["datetime"] = fechas
    if query:
        body["query"] = query
    r = s.post(f"{PC}/stac/v1/search", json=body, timeout=60)
    r.raise_for_status()
    return r.json()["features"]


def _valor(s, coleccion, item, assets, lat, lon):
    r = s.get(f"{PC}/data/v1/item/point/{lon},{lat}", timeout=60,
              params=[("collection", coleccion), ("item", item)] + [("assets", a) for a in assets])
    r.raise_for_status()
    return r.json()["values"]


def ndvi(b4, b8, scl, baseline="05.00"):
    """NDVI de un pixel de Sentinel-2, o None si está nublado o sin dato.

    Desde la versión de procesamiento 04.00 (enero 2022) ESA suma 1000 a cada valor; sin quitarlo
    el NDVI sale aplastado hacia cero. Las escenas de antes (p. ej. 03.00 en 2021) no lo llevan.
    """
    if scl in SCL_MALO or b4 <= 0 or b8 <= 0:
        return None
    if float(baseline) >= 4.0:
        b4, b8 = b4 - 1000, b8 - 1000
    if b4 + b8 <= 0:
        return None
    return round((b8 - b4) / (b8 + b4), 3)


def pendiente(z_n, z_s, z_e, z_o, paso_m):
    """Pendiente en grados por diferencias centrales con vecinos a `paso_m` metros."""
    dzdx = (z_e - z_o) / (2 * paso_m)
    dzdy = (z_n - z_s) / (2 * paso_m)
    return round(math.degrees(math.atan(math.hypot(dzdx, dzdy))), 2)


def promedio_por_fecha(pares):
    """[(fecha, valor), ...] -> [{fecha, ndvi}] ordenado; promedia escenas del mismo día (tiles que se traslapan)."""
    por = {}
    for f, v in pares:
        por.setdefault(f, []).append(v)
    return [{"fecha": f, "ndvi": round(sum(v) / len(v), 3)} for f, v in sorted(por.items())]


def cobertura(s, lat, lon):
    wc = _items(s, "esa-worldcover", lat, lon)[0]
    clase = int(_valor(s, "esa-worldcover", wc["id"], ["map"], lat, lon)[0])
    anuales = _items(s, "io-lulc-annual-v02", lat, lon, limite=20)
    with ThreadPoolExecutor(8) as ex:
        vals = ex.map(lambda it: int(_valor(s, "io-lulc-annual-v02", it["id"], ["data"], lat, lon)[0]), anuales)
        por_anio = {it["properties"]["start_datetime"][:4]: LULC.get(v, v) for it, v in zip(anuales, vals)}
    por_anio = dict(sorted(por_anio.items()))
    es_cultivo = clase == 40 or "cultivo" in por_anio.values()
    return {"worldcover_2021": WORLDCOVER.get(clase, clase), "por_anio": por_anio, "es_cultivo": es_cultivo,
            "aviso": None if es_cultivo else "El punto no parece ser campo de cultivo; revisa la ubicación."}


def terreno(s, lat, lon):
    it = _items(s, "cop-dem-glo-30", lat, lon)[0]["id"]
    paso = 30.0
    dlat, dlon = paso / 111320, paso / (111320 * math.cos(math.radians(lat)))
    pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
    with ThreadPoolExecutor(5) as ex:
        z = list(ex.map(lambda p: _valor(s, "cop-dem-glo-30", it, ["data"], *p)[0], pts))
    return {"elevacion_m": round(z[0], 1), "pendiente_grados": pendiente(z[1], z[2], z[3], z[4], paso)}


def suelo(s, lat, lon):
    params = [("lon", lon), ("lat", lat), ("value", "mean")] + [("property", p) for p in SUELO] + \
             [("depth", d) for d in ("0-5cm", "5-15cm", "15-30cm")]
    r = s.get("https://rest.isric.org/soilgrids/v2.0/properties/query", params=params, timeout=60)
    r.raise_for_status()
    out = {}
    for capa in r.json()["properties"]["layers"]:
        f = capa["unit_measure"]["d_factor"]  # SoilGrids guarda enteros; se divide para unidades normales
        out[SUELO_NOMBRES[capa["name"]]] = {d["label"]: (None if d["values"]["mean"] is None else round(d["values"]["mean"] / f, 2))
                                            for d in capa["depths"]}
    if all(v is None for prof in out.values() for v in prof.values()):
        out["aviso"] = "SoilGrids no tiene suelo aquí (zona urbana, agua o roca)."
    return out


def clima(s, lat, lon, inicio, fin):
    base = {"parameters": CLIMA, "community": "AG", "latitude": lat, "longitude": lon, "format": "JSON"}
    with ThreadPoolExecutor(2) as ex:
        diario = ex.submit(s.get, "https://power.larc.nasa.gov/api/temporal/daily/point", timeout=90,
                           params={**base, "start": inicio.replace("-", ""), "end": fin.replace("-", "")})
        normal = ex.submit(s.get, "https://power.larc.nasa.gov/api/temporal/climatology/point", timeout=90, params=base)
        d, n = diario.result(), normal.result()
    d.raise_for_status()
    n.raise_for_status()
    limpiar = lambda serie: {k: (None if v == -999 else v) for k, v in serie.items()}  # -999 = sin dato en POWER
    return {"diario": {p: limpiar(v) for p, v in d.json()["properties"]["parameter"].items()},
            "normales_30_anios": n.json()["properties"]["parameter"],
            "unidades": {"T2M": "°C", "PRECTOTCORR": "mm/día", "RH2M": "%", "ALLSKY_SFC_SW_DWN": "kWh/m²/día",
                         "GWETTOP": "humedad suelo superficial 0-1", "GWETROOT": "humedad suelo raíces 0-1"}}


def vegetacion(s, lat, lon, inicio, fin):
    escenas = _items(s, "sentinel-2-l2a", lat, lon, f"{inicio}T00:00:00Z/{fin}T23:59:59Z", limite=500,
                     query={"eo:cloud_cover": {"lt": 60}})

    def una(it):
        try:
            b4, b8, scl = _valor(s, "sentinel-2-l2a", it["id"], ["B04", "B08", "SCL"], lat, lon)[:3]
        except requests.RequestException:
            return None
        v = ndvi(b4, b8, scl, it["properties"].get("s2:processing_baseline", "05.00"))
        return None if v is None else (it["properties"]["datetime"][:10], v)

    with ThreadPoolExecutor(16) as ex:
        pares = [p for p in ex.map(una, escenas) if p]
    return {"fuente": "Sentinel-2 L2A, 10 m", "escenas_revisadas": len(escenas), "serie": promedio_por_fecha(pares)}


def aptitud(s, lat, lon):
    nombres = [f"su{tipo}_{c}" for c in CULTIVOS for tipo in ("Hr", "Hg")]
    r = s.get(GAEZ, timeout=90, params={
        "geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPoint", "returnGeometry": "false", "returnCatalogItems": "true",
        "returnPixelValues": "true", "f": "json",
        "mosaicRule": json.dumps({"mosaicMethod": "esriMosaicLockRaster",
                                  "where": "year='1981-2010' AND name IN (%s)" % ",".join(f"'{n}'" for n in nombres)})})
    r.raise_for_status()
    d = r.json()
    capas = [f["attributes"]["name"] for f in d["catalogItems"]["features"]]  # mismo orden que Values (verificado)
    out = {nombre: {"temporal": None, "riego": None} for nombre in CULTIVOS.values()}
    for capa, v in zip(capas, d["properties"]["Values"]):
        tipo, codigo = capa[2:4], capa.split("_")[1]
        try:
            out[CULTIVOS[codigo]]["temporal" if tipo == "Hr" else "riego"] = round(float(v) / 100)  # 0-10000 -> 0-100
        except ValueError:
            pass  # NoData
    orden = sorted(out.items(), key=lambda kv: -max(x or 0 for x in kv[1].values()))
    return {"escala": "0-100, clima 1981-2010, altos insumos", "cultivos": dict(orden)}


def _validar(lat, lon, inicio, fin):
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"coordenadas fuera de rango: {lat}, {lon}")
    if date.fromisoformat(inicio) > date.fromisoformat(fin):
        raise ValueError("inicio después de fin")


def consultar(lat, lon, inicio=None, fin=None, usar_cache=True):
    lat, lon = round(float(lat), 5), round(float(lon), 5)
    fin = fin or (date.today() - timedelta(days=7)).isoformat()  # POWER tarda unos días en publicar lo más reciente
    inicio = inicio or (date.fromisoformat(fin) - timedelta(days=730)).isoformat()
    _validar(lat, lon, inicio, fin)

    archivo = CACHE / f"{lat}_{lon}_{inicio}_{fin}.json"
    if usar_cache and archivo.exists():
        return json.loads(archivo.read_text(encoding="utf-8"))

    s = _sesion()
    tareas = {"cobertura": (cobertura, ()), "terreno": (terreno, ()), "suelo": (suelo, ()),
              "clima": (clima, (inicio, fin)), "vegetacion": (vegetacion, (inicio, fin)), "aptitud": (aptitud, ())}

    def correr(nombre):
        fn, extra = tareas[nombre]
        t0 = time.time()
        try:
            res = fn(s, lat, lon, *extra)
        except Exception as e:  # una fuente caída no tumba a las demás
            res = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
        return nombre, res, round(time.time() - t0, 1)

    with ThreadPoolExecutor(len(tareas)) as ex:
        resultados = list(ex.map(correr, tareas))
    out = {"punto": {"lat": lat, "lon": lon}, "periodo": {"inicio": inicio, "fin": fin},
           "segundos": {n: t for n, _, t in resultados}}
    out.update({n: r for n, r, _ in resultados})

    if not any("error" in r for _, r, _ in resultados):  # solo se guarda si todo salió bien
        archivo.parent.mkdir(parents=True, exist_ok=True)
        archivo.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def _resumen(d):
    c, t, su, a, v = d["cobertura"], d["terreno"], d["suelo"], d["aptitud"], d["vegetacion"]
    print(f"Punto {d['punto']['lat']}, {d['punto']['lon']}  ({d['periodo']['inicio']} a {d['periodo']['fin']})")
    print(f"  tiempos: {d['segundos']}")
    if "error" not in c:
        print(f"  cobertura: {c['worldcover_2021']}; por año: {c['por_anio']}" + (f"  ⚠ {c['aviso']}" if c["aviso"] else ""))
    if "error" not in t:
        print(f"  terreno: {t['elevacion_m']} m, pendiente {t['pendiente_grados']}°")
    if "error" not in su:
        g = lambda k: su[k]["0-5cm"]
        print(f"  suelo 0-5 cm: arcilla {g('arcilla_%')}%, arena {g('arena_%')}%, pH {g('ph')}, carbono {g('carbono_organico_g_kg')} g/kg")
    if "error" not in d["clima"]:
        n = d["clima"]["normales_30_anios"]
        print(f"  clima normal: {n['T2M']['ANN']} °C, lluvia {round(n['PRECTOTCORR']['ANN'] * 365)} mm/año; "
              f"{len(d['clima']['diario']['T2M'])} días de serie diaria")
    if "error" not in v:
        print(f"  NDVI: {len(v['serie'])} fechas sin nubes de {v['escenas_revisadas']} escenas")
    if "error" not in a:
        top = list(a["cultivos"].items())[:6]
        print("  mejor aptitud: " + ", ".join(f"{k} {x['temporal']}/{x['riego']}" for k, x in top) + "  (temporal/riego)")
    for k in ("cobertura", "terreno", "suelo", "clima", "vegetacion", "aptitud"):
        if "error" in d[k]:
            print(f"  ERROR {k}: {d[k]['error']}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 5):
        sys.exit(__doc__)
    datos = consultar(float(sys.argv[1]), float(sys.argv[2]), *sys.argv[3:5])
    _resumen(datos)
