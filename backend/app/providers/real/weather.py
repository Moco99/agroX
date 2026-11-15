"""RealWeatherProvider: NASA POWER daily series cleaned by pipeline/build_weather.py."""

from __future__ import annotations

import csv
import math
from datetime import date
from functools import lru_cache
from pathlib import Path

from app.providers.ports import DataNotFoundError
from app.providers.real import read_json
from app.schemas.common import DataState, Location, Provenance
from app.schemas.weather import WeatherDay, WeatherSeries

WEATHER_CSV = Path("weather") / "power_daily_story_pilot.csv"
WEATHER_META = Path("weather") / "power_daily_story_pilot.meta.json"


def _opt(value: str) -> float | None:
    if value == "":
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


CORE_COLUMNS = ("t_mean", "t_max", "t_min", "precip", "rh_mean", "solar_rad", "wind_2m")


@lru_cache(maxsize=4)
def _load_days(path: str, mtime_ns: int) -> tuple[WeatherDay, ...]:
    days: list[WeatherDay] = []
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            # A day without every core variable cannot feed Penman-Monteith nor the balance: it is dropped
            # and reported as a gap (none exist in the 2023-2024 file, see the derived meta qa_summary)
            if any(_opt(row[c]) is None for c in CORE_COLUMNS):
                continue
            flags = [f for f in row["qa_flags"].split(";") if f]
            days.append(
                WeatherDay(
                    date=date.fromisoformat(row["date"]),
                    t_mean=float(row["t_mean"]),
                    t_max=float(row["t_max"]),
                    t_min=float(row["t_min"]),
                    precip=max(0.0, float(row["precip"])),
                    rh_mean=float(row["rh_mean"]),
                    solar_rad=float(row["solar_rad"]),
                    wind_2m=float(row["wind_2m"]),
                    gwet_root=_opt(row["gwet_root"]),
                    gwet_top=_opt(row["gwet_top"]),
                    qa_flags=flags,
                )
            )
    days.sort(key=lambda d: d.date)
    return tuple(days)


class RealWeatherProvider:
    def __init__(self, derived_dir: Path) -> None:
        self._csv = derived_dir / WEATHER_CSV
        self._meta_path = derived_dir / WEATHER_META

    @classmethod
    def is_available(cls, derived_dir: Path) -> bool:
        return (derived_dir / WEATHER_CSV).exists()

    def _days(self) -> tuple[WeatherDay, ...]:
        if not self._csv.exists():
            raise DataNotFoundError("derived weather series missing: run `make derived`")
        return _load_days(str(self._csv), self._csv.stat().st_mtime_ns)

    def coverage(self) -> tuple[date, date]:
        days = self._days()
        return days[0].date, days[-1].date

    def get_daily(self, start: date, end: date) -> WeatherSeries:
        meta = read_json(self._meta_path)
        location = meta.get("location")
        loc = location if isinstance(location, dict) else {}
        days = [d for d in self._days() if start <= d.date <= end]
        warnings: list[str] = []
        flagged = sorted({f for d in days for f in d.qa_flags})
        if flagged:
            flagged_days = sum(1 for d in days if d.qa_flags)
            warnings.append(
                f"POWER QA flags in range ({', '.join(flagged)}) on {flagged_days} day(s): values kept unchanged"
            )
        expected = (min(end, self.coverage()[1]) - max(start, self.coverage()[0])).days + 1
        if 0 < len(days) < expected:
            warnings.append(f"{expected - len(days)} day(s) without complete POWER data were skipped")
        cov_start, cov_end = self.coverage()
        if start < cov_start or end > cov_end:
            warnings.append(f"requested range exceeds POWER coverage {cov_start}..{cov_end}; series truncated")
        return WeatherSeries(
            location=Location(lat=float(loc.get("lat", 41.995)), lon=float(loc.get("lon", -93.49))),
            elevation_m=float(loc.get("elevation_m", 310.22)),
            days=days,
            provenance=Provenance(
                source=str(meta.get("source", "NASA POWER")),
                data_state=DataState.MEASURED,
                resolution=str(meta.get("resolution", "")) or None,
                method=str(meta.get("method", "")) or None,
            ),
            warnings=warnings,
        )
