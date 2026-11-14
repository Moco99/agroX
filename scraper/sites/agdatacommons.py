"""USDA Ag Data Commons (corre sobre Figshare, grupo 51648). Busca datasets por palabras y baja sus tablas. Sin llave.

La búsqueda de Figshare es amplia (trae genética, plagas...), así que solo se queda con datasets
cuyo título contiene la frase buscada, y solo con archivos de tabla.
"""

API = "https://api.figshare.com/v2"
GROUP = 51648
TABLES = (".csv", ".xlsx", ".xls", ".txt", ".tsv", ".zip")


def links(session, src):
    max_bytes = src.get("max_mb", 50) * 1_000_000
    out, seen = [], set()
    for term in src["search"]:
        r = session.post(f"{API}/articles/search", json={"search_for": term, "group": GROUP, "page_size": 50}, timeout=60)
        r.raise_for_status()
        for art in r.json():
            if art["id"] in seen or term.lower() not in art["title"].lower():
                continue
            seen.add(art["id"])
            files = session.get(f"{API}/articles/{art['id']}/files", timeout=60)
            files.raise_for_status()
            for f in files.json():
                if not f["name"].lower().endswith(TABLES):
                    continue
                if f["size"] <= max_bytes:
                    out.append({"url": f["download_url"], "name": f"{art['id']}_{f['name']}"})
                else:
                    print(f"   (omitido por pesar {f['size'] / 1e6:.0f} MB: {f['name']})")
    return out
