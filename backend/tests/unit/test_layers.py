"""Architecture: the engine stays pure (no web framework, adapters, services or HTTP clients)."""

from __future__ import annotations

import ast
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[2] / "app" / "engine"
FORBIDDEN = ("fastapi", "starlette", "app.providers", "app.services", "app.api", "httpx", "requests", "urllib")
FORBIDDEN_CALLS = {"open"}


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
    return names


def test_engine_does_not_import_io_layers() -> None:
    files = sorted(ENGINE_DIR.glob("*.py"))
    assert files
    for f in files:
        for name in _imports(f):
            assert not name.startswith(FORBIDDEN), f"{f.name} imports {name}"


def test_engine_does_not_open_files() -> None:
    for f in ENGINE_DIR.glob("*.py"):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        calls = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        assert not calls & FORBIDDEN_CALLS, f"{f.name} performs I/O"
