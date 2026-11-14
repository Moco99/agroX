"""Descarga los datasets de cada fuente en sources.json a data/raw/<id>/.

Uso:
    python scraper/scrape.py            # todas las fuentes habilitadas
    python scraper/scrape.py siap inegi # solo esas
"""
import csv
import hashlib
import importlib.util
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
DATA = ROOT.parent / "data"
UA = "agroX-hackathon-scraper/0.1"
DELAY = 1.0  # segundos entre descargas, para no saturar los sitios
EXTS = (".csv", ".xlsx", ".xls", ".json", ".zip", ".xml", ".geojson", ".parquet", ".txt")
MANIFEST_COLS = ["source", "url", "path", "sha256", "bytes", "fetched_at"]

_robots: dict[str, RobotFileParser | None] = {}


def find_links(html: str, base_url: str, pattern: str | None = None, exts=EXTS) -> list[str]:
    """Links a archivos de datos en una página. `pattern` (regex) reemplaza el filtro por extensión."""
    out = []
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        url = urljoin(base_url, a["href"].strip())
        ok = re.search(pattern, url) if pattern else urlparse(url).path.lower().endswith(tuple(exts))
        if ok and url not in out:
            out.append(url)
    return out


def filename_for(url: str) -> str:
    # El hash evita choques entre /2023/datos.csv y /2024/datos.csv.
    name = unquote(Path(urlparse(url).path).name) or "archivo"
    return f"{hashlib.sha1(url.encode()).hexdigest()[:8]}_{name}"


def allowed(url: str) -> bool:
    host = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if host not in _robots:
        rp = RobotFileParser(host + "/robots.txt")
        try:
            rp.read()
        except Exception:
            rp = None  # sin robots.txt legible: se permite
        _robots[host] = rp
    rp = _robots[host]
    return rp is None or rp.can_fetch(UA, url)


def links_for(session: requests.Session, src: dict) -> list[str]:
    """Usa scraper/sites/<id>.py si existe (sitios con API o JS); si no, busca links en la página."""
    hook = ROOT / "sites" / f"{src['id']}.py"
    if hook.exists():
        spec = importlib.util.spec_from_file_location(src["id"], hook)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.links(session, src)
    r = session.get(src["url"], timeout=60)
    r.raise_for_status()
    return find_links(r.text, r.url, src.get("pattern"), src.get("exts", EXTS))


def download(session: requests.Session, url: str, dest: Path) -> tuple[str, int] | None:
    """Descarga en streaming. Devuelve (sha256, bytes), o None si ya existía."""
    if dest.exists():
        return None
    tmp = dest.with_suffix(dest.suffix + ".part")
    h, size = hashlib.sha256(), 0
    with session.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
                h.update(chunk)
                size += len(chunk)
    tmp.replace(dest)  # solo archivos completos quedan con su nombre final
    return h.hexdigest(), size


def run(ids: list[str]) -> int:
    sources = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    sources = [s for s in sources if (s["id"] in ids if ids else s.get("enabled", True))]
    session = requests.Session()
    session.headers["User-Agent"] = UA
    manifest = DATA / "manifest.csv"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    new_file = not manifest.exists()
    failures = 0

    with open(manifest, "a", newline="", encoding="utf-8") as mf:
        writer = csv.DictWriter(mf, MANIFEST_COLS)
        if new_file:
            writer.writeheader()
        for src in sources:
            print(f"== {src['id']}")
            try:
                urls = links_for(session, src)
            except Exception as e:
                print(f"   ERROR listando: {e}")
                failures += 1
                continue
            print(f"   {len(urls)} archivos encontrados")
            out_dir = DATA / "raw" / src["id"]
            out_dir.mkdir(parents=True, exist_ok=True)
            for url in urls:
                if not allowed(url):
                    print(f"   robots.txt bloquea {url}")
                    continue
                dest = out_dir / filename_for(url)
                try:
                    res = download(session, url, dest)
                except Exception as e:
                    print(f"   ERROR {url}: {e}")
                    failures += 1
                    continue
                if res is None:
                    continue
                sha, size = res
                writer.writerow({"source": src["id"], "url": url, "path": dest.relative_to(DATA).as_posix(),
                                 "sha256": sha, "bytes": size,
                                 "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
                mf.flush()
                print(f"   ok {dest.name} ({size:,} B)")
                time.sleep(DELAY)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
