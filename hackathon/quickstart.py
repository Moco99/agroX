"""Punto de entrada mínimo para un hackathon en agroX.

Ejemplo de uso:
    python3 hackathon/quickstart.py power cdl prism
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRAPER_DIR = ROOT / "scraper"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SCRAPER_DIR) not in sys.path:
    sys.path.insert(0, str(SCRAPER_DIR))

from scrape import run  # noqa: E402


def main() -> int:
    ids = sys.argv[1:]
    if not ids:
        ids = ["power", "cdl", "prism"]
    print(f"[gemeloVirtual] Ejecutando fuentes: {', '.join(ids)}")
    return run(ids)


if __name__ == "__main__":
    raise SystemExit(main())
