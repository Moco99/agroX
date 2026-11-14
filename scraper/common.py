"""Utilidades compartidas por scrape.py y los conectores en sites/."""
import os
import time
from pathlib import Path


class Skip(Exception):
    """El conector no puede correr (falta una llave, fuera de cobertura). No cuenta como error."""


def load_env(path: Path) -> None:
    """Carga KEY=VALUE de .env sin pisar variables ya definidas."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def need(var: str, how: str) -> str:
    val = os.environ.get(var)
    if not val:
        raise Skip(f"falta {var} en .env ({how})")
    return val


def center(area: dict) -> tuple[float, float]:
    w, s, e, n = area["bbox"]
    return (w + e) / 2, (s + n) / 2  # (lon, lat)


def months(area: dict) -> list[str]:
    """['YYYYMM', ...] entre start y end del área."""
    y, m = int(area["start"][:4]), int(area["start"][5:7])
    ey, em = int(area["end"][:4]), int(area["end"][5:7])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def poll(fn, every: float = 10, timeout: float = 1800):
    """Llama fn() hasta que devuelva algo distinto de None (trabajos asíncronos)."""
    end = time.time() + timeout
    while time.time() < end:
        res = fn()
        if res is not None:
            return res
        time.sleep(every)
    raise TimeoutError("el trabajo no terminó a tiempo; vuelve a correr la fuente más tarde")
