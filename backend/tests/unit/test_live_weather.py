"""LivePowerWeatherProvider: same days as the derived series, honest fallback, disk cache. No network."""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

from app.config import DEFAULT_DERIVED_DIR
from app.providers.live.weather import COLUMN_MAP, LivePowerWeatherProvider, PowerJson
from app.providers.real.weather import WEATHER_CSV, RealWeatherProvider

DERIVED = Path(DEFAULT_DERIVED_DIR)
pytestmark = pytest.mark.skipif(not (DERIVED / WEATHER_CSV).exists(), reason="derived/ not built")
START, END = date(2023, 1, 1), date(2024, 12, 31)


def _power_json_from_derived() -> PowerJson:
    """Rebuild the POWER API answer for 2023-2024 from the derived CSV (which is POWER verbatim)."""
    params: dict[str, dict[str, float]] = {name: {} for name in COLUMN_MAP}
    with open(DERIVED / WEATHER_CSV, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            key = row["date"].replace("-", "")
            for name, field in COLUMN_MAP.items():
                params[name][key] = float(row[field]) if row[field] != "" else -999.0
    return {"geometry": {"coordinates": [-93.49, 41.995, 310.22]}, "properties": {"parameter": params}}


def _live(tmp_path: Path, fetcher: object) -> LivePowerWeatherProvider:
    return LivePowerWeatherProvider(DERIVED, tmp_path, 41.995, -93.49, fetcher=fetcher, today=lambda: date(2025, 1, 3))  # type: ignore[arg-type]


def test_live_matches_derived_series(tmp_path: Path) -> None:
    data = _power_json_from_derived()
    live = _live(tmp_path, lambda *_: data).get_daily(START, END)
    real = RealWeatherProvider(DERIVED).get_daily(START, END)
    assert live.days == real.days
    assert "live" in live.provenance.source
    assert not any("unreachable" in w for w in live.warnings)


def test_unreachable_api_falls_back_to_derived(tmp_path: Path) -> None:
    def boom(*_: object) -> PowerJson:
        raise OSError("network down")

    live = _live(tmp_path, boom).get_daily(START, END)
    assert live.days == RealWeatherProvider(DERIVED).get_daily(START, END).days
    assert any("POWER API unreachable" in w for w in live.warnings)


def test_incomplete_days_dropped_and_flagged(tmp_path: Path) -> None:
    data = _power_json_from_derived()
    params = data["properties"]["parameter"]  # type: ignore[index]
    # No solar radiation (as POWER before 1984): the day cannot feed the balance
    params["ALLSKY_SFC_SW_DWN"]["20240115"] = -999.0
    # Only the wetness index missing: the day is kept, flagged, with no index
    params["GWETROOT"]["20240116"] = -999.0
    days = {d.date: d for d in _live(tmp_path, lambda *_: data).get_daily(START, END).days}
    assert date(2024, 1, 15) not in days
    assert days[date(2024, 1, 16)].gwet_root is None
    assert "missing" in days[date(2024, 1, 16)].qa_flags


def test_disk_cache_avoids_second_request(tmp_path: Path) -> None:
    calls: list[int] = []
    data = _power_json_from_derived()

    def counting(*_: object) -> PowerJson:
        calls.append(1)
        return data

    _live(tmp_path, counting).coverage()
    _live(tmp_path, counting).coverage()
    assert len(calls) == 1
