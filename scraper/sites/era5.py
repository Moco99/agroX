"""ERA5 (ECMWF / Copernicus Climate Data Store): reanálisis climático recortado al área.

El CDS trabaja por pedidos: se manda el pedido, se espera en la cola y luego se baja el resultado.
Las rutas son las mismas que usa el cliente oficial (cdsapi / ecmwf-datastores-client).
Antes de usarlo hay que aceptar la licencia del dataset en su página del CDS. NO PROBADO con llave.
"""
import requests

from common import need, poll

API = "https://cds.climate.copernicus.eu/api/retrieve/v1"


def links(session, src):
    key = need("CDS_API_KEY", "gratis en https://cds.climate.copernicus.eu, tu perfil -> API Token")
    a = src["area"]
    w, s, e, n = a["bbox"]
    headers = {"PRIVATE-TOKEN": key}
    request = {
        "product_type": ["monthly_averaged_reanalysis"],
        "variable": src["variables"],
        "year": [str(y) for y in range(int(a["start"][:4]), int(a["end"][:4]) + 1)],
        "month": [f"{m:02d}" for m in range(1, 13)],
        "time": ["00:00"],
        "area": [n, w, s, e],  # ERA5 pide norte, oeste, sur, este
        "data_format": "netcdf",
        "download_format": "unarchived",
    }
    if src.get("job_id"):  # pedido ya enviado antes: se retoma sin mandar otro (no pierde lugar en la cola)
        job = src["job_id"]
    else:
        r = session.post(f"{API}/processes/{src['dataset']}/execution", json={"inputs": request}, headers=headers, timeout=60)
        r.raise_for_status()
        job = r.json()["jobID"]
    print(f"   pedido ERA5 {job} en cola...")

    def status():
        try:
            st = session.get(f"{API}/jobs/{job}", headers=headers, timeout=60).json()["status"]
        except requests.RequestException as e:  # cortes de red: se reintenta en el siguiente ciclo
            print(f"   (reintentando, error de red: {type(e).__name__})")
            return None
        if st in ("failed", "dismissed", "rejected"):
            raise RuntimeError(f"ERA5 {job}: {st}")
        return st if st == "successful" else None

    poll(status, every=15)
    res = session.get(f"{API}/jobs/{job}/results", headers=headers, timeout=60)
    res.raise_for_status()
    return [{"url": res.json()["asset"]["value"]["href"], "name": f"era5_{src['dataset']}.nc"}]
