"""Standalone scraper cache and request budgets do not require network."""

import importlib.util
import json
from pathlib import Path

import pytest

from app.providers import points
from app.storage.ports import StoreUnavailableError


@pytest.fixture
def scraper(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[3] / "scraper" / "punto.py"
    spec = importlib.util.spec_from_file_location("point_scraper_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "CACHE", tmp_path)
    for section in ("cobertura", "terreno", "suelo", "clima", "vegetacion", "aptitud"):
        monkeypatch.setattr(module, section, lambda *args: {"value": 1})
    return module


def test_malformed_and_failed_cache_entries_are_retried(scraper, tmp_path):
    path = tmp_path / "1.0_2.0_2024-01-01_2024-02-01.json"
    path.write_text("[]")
    result = scraper.consultar(1, 2, "2024-01-01", "2024-02-01")
    assert result["clima"] == {"value": 1}
    cached = json.loads(path.read_text())
    cached["clima"] = {"error": "temporary failure"}
    path.write_text(json.dumps(cached))
    assert scraper.consultar(1, 2, "2024-01-01", "2024-02-01")["clima"] == {"value": 1}


def test_failed_section_is_not_written_to_cache(scraper, tmp_path, monkeypatch):
    def unavailable(*args):
        raise RuntimeError("offline")

    monkeypatch.setattr(scraper, "suelo", unavailable)
    result = scraper.consultar(1, 2, "2024-01-01", "2024-02-01")
    assert "error" in result["suelo"]
    assert result["clima"] == {"value": 1}
    assert not list(tmp_path.glob("*.json"))


def test_deadline_prevents_new_requests(scraper):
    session = scraper.DeadlineSession()
    session.deadline = 0
    with pytest.raises(scraper.requests.Timeout):
        session.get("https://example.invalid")


def test_provider_rejects_busy_queries():
    permits = []
    try:
        for _ in range(4):
            assert points._CAPACITY.acquire(False)
            permits.append(True)
        with pytest.raises(StoreUnavailableError):
            points.query(1, 2, "2024-01-01", "2024-02-01", False)
    finally:
        for _ in permits:
            points._CAPACITY.release()


def test_unwritable_cache_keeps_success(scraper, tmp_path, monkeypatch):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("file")
    monkeypatch.setattr(scraper, "CACHE", blocker)
    assert scraper.consultar(1, 2, "2024-01-01", "2024-02-01")["clima"] == {"value": 1}


def test_pixel_outage_differs_from_clouds(scraper, monkeypatch):
    original = points._consult().__globals__["vegetacion"]
    monkeypatch.setattr(scraper, "vegetacion", original)
    # Load this function against its own globals to mock the actual source calls.
    globals_ = original.__globals__
    scenes = [{"id": "scene", "properties": {"datetime": "2024-01-01T00:00:00Z"}}]
    monkeypatch.setitem(globals_, "_items", lambda *a, **kw: scenes)

    def outage(*a, **kw):
        raise scraper.requests.Timeout("offline")

    monkeypatch.setitem(globals_, "_valor", outage)
    with pytest.raises(scraper.requests.RequestException):
        original(None, 1, 2, "2024-01-01", "2024-02-01")
    monkeypatch.setitem(globals_, "_valor", lambda *a, **kw: [2000, 4000, 9])
    assert original(None, 1, 2, "2024-01-01", "2024-02-01")["serie"] == []
    monkeypatch.setitem(globals_, "_items", lambda *a, **kw: [])
    assert original(None, 1, 2, "2024-01-01", "2024-02-01")["serie"] == []
