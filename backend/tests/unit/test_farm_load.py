"""Load contract (prepare / status) with injected fakes: per-stage progress, idempotence, failures. No network."""

from __future__ import annotations

import dataclasses
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import providers_dep
from app.config import DEFAULT_DERIVED_DIR
from app.main import create_app
from app.providers.factory import Providers
from app.providers.live.land_cover import LandCoverProvider
from app.providers.live.soil import LiveSoilProvider
from app.services import farm_load_service as svc

DERIVED = Path(DEFAULT_DERIVED_DIR)
PT = "pt_18.83_-96.78"
ALL_STAGES = {"terrain", "soil", "weather", "ndvi", "land_cover", "basemap", "heightmap"}


def _soilgrids(*_: object) -> dict[str, object]:
    depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
    layer = lambda name, v: {  # noqa: E731
        "name": name,
        "unit_measure": {"d_factor": 10},
        "depths": [{"label": d, "values": {"mean": v}} for d in depths],
    }
    return {"properties": {"layers": [layer("wv0033", 328), layer("wv1500", 150)]}}


class Fakes:
    """Counts runner calls so idempotence is observable; `fail` names stages whose runner raises."""

    def __init__(self, tmp: Path, fail: set[str] | None = None, gate: threading.Event | None = None) -> None:
        self.calls: dict[str, int] = {}
        self.fail = fail or set()
        zone = SimpleNamespace(zone_id="zone_nw", terrain=SimpleNamespace(elevation_mean_m=250.0))
        outer = self

        def hit(name: str) -> None:
            outer.calls[name] = outer.calls.get(name, 0) + 1
            if gate is not None:
                gate.wait(5)
            if name in outer.fail:
                raise RuntimeError(f"{name} down")

        class Farm:
            def get_farm(self, _id: str) -> Any:
                hit("terrain")
                return SimpleNamespace(zones=[zone])

        class Obs:
            def ndvi_series(self, _id: str, _src: str) -> Any:
                hit("ndvi")
                return SimpleNamespace(warnings=[], points=[SimpleNamespace(date="2024-01-01")])

        class Imagery:
            def basemap(self, _id: str) -> Any:
                hit("basemap")
                return b"", {"source": "S2", "acquired": "2024-01-01"}

            def heightmap(self, _id: str) -> Any:
                hit("heightmap")
                return {"width": 4, "height": 4, "min_m": 1, "max_m": 2}

        self.providers = Providers(
            mode="live",
            weather=SimpleNamespace(),  # type: ignore[arg-type]
            soil=SimpleNamespace(),  # type: ignore[arg-type]
            catalog=SimpleNamespace(),  # type: ignore[arg-type]
            farm=Farm(),  # type: ignore[arg-type]
            observations=Obs(),  # type: ignore[arg-type]
            point_imagery=Imagery(),  # type: ignore[arg-type]
            land_cover=LandCoverProvider(tmp, fetcher=lambda *_: {"es_cultivo": True}, retry_delays_s=(0.0,)),
            live_soil=LiveSoilProvider(DERIVED, tmp, fetcher=_soilgrids, min_interval_s=0, retry_delays_s=(0.0,)),
        )
        self.weather = SimpleNamespace(coverage=lambda: ("1981-01-01", "2024-12-31"))


def _fakes(tmp: Path, monkeypatch: pytest.MonkeyPatch, **kw: Any) -> Fakes:
    f = Fakes(tmp, **kw)
    monkeypatch.setattr(svc, "weather_for", lambda _p, _id: f.weather)
    return f


def _settle(f: Fakes, timeout: float = 5.0) -> Any:
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = svc.status(f.providers, PT)
        if st.poll_after_s is None:
            return st
        time.sleep(0.05)
    raise AssertionError("load did not settle")


def test_unprepared_farm_is_not_started_and_status_starts_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = _fakes(tmp_path, monkeypatch)
    st = svc.status(f.providers, PT)
    assert st.state == "not_started" and st.progress == 0 and not st.soil_final
    assert {s.stage for s in st.stages} == ALL_STAGES
    assert all(s.status == "pending" for s in st.stages)
    # A GET must not start the SoilGrids / land-cover fetches by itself
    time.sleep(0.2)
    assert f.providers.live_soil.status(PT) is None  # type: ignore[union-attr]
    assert f.calls == {}


def test_prepare_reports_every_stage_and_reaches_ready(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    f = _fakes(tmp_path, monkeypatch)
    first = svc.prepare(f.providers, PT)
    assert first.state == "loading" and first.poll_after_s is not None
    st = _settle(f)
    assert st.state == "ready" and st.progress == 1 and st.soil_final and st.failed_stages == []
    assert {s.stage: s.status for s in st.stages} == dict.fromkeys(ALL_STAGES, "ready")


def test_prepare_is_idempotent_while_running_and_after_ready(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    gate = threading.Event()
    f = _fakes(tmp_path, monkeypatch, gate=gate)
    svc.prepare(f.providers, PT)
    svc.prepare(f.providers, PT)
    assert any(s.status == "running" for s in svc.status(f.providers, PT).stages)
    gate.set()
    _settle(f)
    svc.prepare(f.providers, PT)
    _settle(f)
    assert f.calls == {"terrain": 1, "ndvi": 1, "basemap": 1, "heightmap": 1}


def test_failed_stage_is_reported_and_retried_only_after_the_window(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = _fakes(tmp_path, monkeypatch, fail={"terrain", "basemap"})
    svc.prepare(f.providers, PT)
    st = _settle(f)
    assert set(st.failed_stages) == {"terrain", "basemap"}
    assert any(w.startswith("terrain failed") for w in st.warnings)
    # Optional basemap failing adds no warning; a prepare within the retry window does not rerun anything
    assert not any(w.startswith("basemap") for w in st.warnings)
    svc.prepare(f.providers, PT)
    _settle(f)
    assert f.calls["terrain"] == 1
    monkeypatch.setattr(svc, "RETRY_FAILED_AFTER_S", -1.0)
    f.fail.clear()
    svc.prepare(f.providers, PT)
    st = _settle(f)
    assert f.calls["terrain"] == 2 and st.failed_stages == []


def test_soilgrids_outage_is_provisional_not_failed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: object) -> dict[str, object]:
        raise TimeoutError("slow")

    f = _fakes(tmp_path, monkeypatch)
    soil = LiveSoilProvider(DERIVED, tmp_path / "b", fetcher=boom, min_interval_s=0, retry_delays_s=(0.0,))
    f.providers = dataclasses.replace(f.providers, live_soil=soil)
    svc.prepare(f.providers, PT)
    st = _settle(f)
    s = next(s for s in st.stages if s.stage == "soil")
    assert s.status == "provisional" and s.retry_after_s is not None and not st.soil_final


def test_http_contract_unknown_ids_and_non_live_modes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    f = _fakes(tmp_path, monkeypatch)
    app = create_app()
    app.dependency_overrides[providers_dep] = lambda: f.providers
    client = TestClient(app)
    assert client.get("/api/farms/nope/status").status_code == 404
    assert client.post("/api/farms/nope/prepare").status_code == 404
    assert client.get("/api/farms/pt_95_10/status").status_code == 422
    r = client.post(f"/api/farms/{PT}/prepare")
    assert r.status_code == 202 and r.json()["farm_id"] == PT
    assert {s["stage"] for s in r.json()["stages"]} == ALL_STAGES
    _settle(f)
    offline = dataclasses.replace(f.providers, mode="synthetic")
    app.dependency_overrides[providers_dep] = lambda: offline
    assert client.get(f"/api/farms/{PT}/status").status_code == 404
    assert client.get("/api/farms/story_pilot_farm/status").json()["state"] == "ready"
