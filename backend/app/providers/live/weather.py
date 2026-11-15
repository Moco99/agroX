"""LivePowerWeatherProvider: NASA POWER daily point series fetched from the API, 1981 -> today.

Same columns, units and QA flags as pipeline/build_weather.py, so on 2023-2024 it returns exactly what
RealWeatherProvider returns (tests/unit/test_live_weather.py). The long history unlocks the precipitation
anomaly in the climate service (open item O-7). Solar radiation starts in 1984 in POWER, so days before
that lack a core variable and are dropped like any other incomplete day.

One request per day and location (~3 s, ~3 MB), cached on disk; if POWER is unreachable the provider
serves the derived series and says so in the warnings.
"""

from __future__ import annotations

import json
import statistics
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path

from app.providers.ports import DataNotFoundError
from app.providers.real.weather import CORE_COLUMNS, RealWeatherProvider
from app.schemas.common import DataState, Location, Provenance
from app.schemas.weather import WeatherDay, WeatherSeries

# ─────────────────────────────────────────
# Section: Constants (mirror pipeline/build_weather.py)
# ─────────────────────────────────────────

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
COLUMN_MAP = {
    "T2M": "t_mean",
    "T2M_MAX": "t_max",
    "T2M_MIN": "t_min",
    "PRECTOTCORR": "precip",
    "RH2M": "rh_mean",
    "ALLSKY_SFC_SW_DWN": "solar_rad",
    "WS2M": "wind_2m",
    "GWETROOT": "gwet_root",
    "GWETTOP": "gwet_top",
    "FROST_DAYS": "frost_days",
}
MISSING_SENTINEL = -999.0
# QA heuristics copied from the pipeline so both modes flag the same days (product configuration, not science)
T_OUTLIER_DEGC = 12.0
PRECIP_EXTREME_MM = 150.0
HISTORY_START = date(1981, 1, 1)
REFRESH_SECONDS = 24 * 3600

PowerJson = dict[str, object]
Fetcher = Callable[[float, float, date, date], PowerJson]


# ─────────────────────────────────────────
# Section: Fetch and parse
# ─────────────────────────────────────────


def fetch_power(lat: float, lon: float, start: date, end: date) -> PowerJson:
    query = urllib.parse.urlencode(
        {
            "parameters": ",".join(COLUMN_MAP),
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "format": "JSON",
        }
    )
    req = urllib.request.Request(f"{POWER_URL}?{query}", headers={"User-Agent": "agrox-backend"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    if not isinstance(data, dict):
        raise ValueError("POWER: unexpected response")
    return data


def _rolling_median(values: list[float | None], i: int) -> float | None:
    # Centered 15-day window with at least 5 values, like pandas rolling(15, center=True, min_periods=5)
    window = [v for v in values[max(0, i - 7) : i + 8] if v is not None]
    return statistics.median(window) if len(window) >= 5 else None


def parse_power(data: PowerJson) -> tuple[tuple[WeatherDay, ...], Location, float]:
    """POWER JSON -> clean WeatherDay tuple (incomplete days dropped), location and elevation."""
    props = data["properties"]
    geometry = data["geometry"]
    assert isinstance(props, dict) and isinstance(geometry, dict)
    params = props["parameter"]
    assert isinstance(params, dict)
    keys = sorted(params["T2M"])
    rows: list[dict[str, float | None]] = []
    for k in keys:
        row: dict[str, float | None] = {}
        for power_name, field in COLUMN_MAP.items():
            v = float(params[power_name][k])
            row[field] = None if v == MISSING_SENTINEL else v
        rows.append(row)
    t_means = [r["t_mean"] for r in rows]
    days: list[WeatherDay] = []
    for i, (k, r) in enumerate(zip(keys, rows, strict=True)):
        flags: list[str] = []
        if any(v is None for v in r.values()):
            flags.append("missing")
        med = _rolling_median(t_means, i)
        t_mean = r["t_mean"]
        if t_mean is not None and med is not None and abs(t_mean - med) > T_OUTLIER_DEGC:
            flags.append("t_outlier")
        # A day without every core variable cannot feed Penman-Monteith nor the balance (same rule as Real*)
        if any(r[c] is None for c in CORE_COLUMNS):
            continue
        core = {c: float(r[c] or 0.0) for c in CORE_COLUMNS}
        if core["t_max"] < core["t_min"]:
            flags.append("tmax_lt_tmin")
        if core["precip"] > PRECIP_EXTREME_MM:
            flags.append("precip_extreme")
        if core["precip"] < 0:
            flags.append("precip_negative")
        days.append(
            WeatherDay(
                date=date(int(k[:4]), int(k[4:6]), int(k[6:])),
                t_mean=core["t_mean"],
                t_max=core["t_max"],
                t_min=core["t_min"],
                precip=max(0.0, core["precip"]),
                rh_mean=core["rh_mean"],
                solar_rad=core["solar_rad"],
                wind_2m=core["wind_2m"],
                gwet_root=r["gwet_root"],
                gwet_top=r["gwet_top"],
                qa_flags=flags,
            )
        )
    coords = geometry["coordinates"]
    assert isinstance(coords, list)
    return tuple(days), Location(lat=float(coords[1]), lon=float(coords[0])), float(coords[2])


# ─────────────────────────────────────────
# Section: Provider
# ─────────────────────────────────────────


class LivePowerWeatherProvider(RealWeatherProvider):
    """Reuses RealWeatherProvider's range/QA warnings; only the source of the days changes."""

    def __init__(
        self,
        derived_dir: Path,
        cache_dir: Path,
        lat: float,
        lon: float,
        fetcher: Fetcher = fetch_power,
        today: Callable[[], date] = date.today,
        allow_fallback: bool = True,
    ) -> None:
        super().__init__(derived_dir)
        # Point farms must never fall back to the pilot series: that would be weather from somewhere else
        self._allow_fallback = allow_fallback
        self._cache_dir = cache_dir
        self._lat, self._lon = lat, lon
        self._fetcher = fetcher
        self._today = today
        self._loaded_at = 0.0
        self._live: tuple[tuple[WeatherDay, ...], Location, float] | None = None
        self._error: str | None = None

    def _cache_file(self, end: date) -> Path:
        return self._cache_dir / f"power_{self._lat}_{self._lon}_{HISTORY_START}_{end}.json"

    def _load(self) -> None:
        if self._live is not None and time.time() - self._loaded_at < REFRESH_SECONDS:
            return
        # POWER publishes with a few days of lag; asking for today just returns -999 rows
        end = self._today() - timedelta(days=3)
        cache = self._cache_file(end)
        try:
            if cache.exists():
                data = json.loads(cache.read_text(encoding="utf-8"))
            else:
                data = self._fetcher(self._lat, self._lon, HISTORY_START, end)
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(data), encoding="utf-8")
            self._live = parse_power(data)
            self._error = None
        except Exception as exc:
            # Keep serving: an unreachable API must not take the twin down, but it must be visible
            self._live = None
            self._error = f"{type(exc).__name__}: {str(exc)[:160]}"
        self._loaded_at = time.time()

    def _days(self) -> tuple[WeatherDay, ...]:
        self._load()
        if self._live:
            return self._live[0]
        if not self._allow_fallback:
            raise DataNotFoundError(f"NASA POWER unavailable for {self._lat}, {self._lon}: {self._error}")
        return super()._days()

    def get_daily(self, start: date, end: date) -> WeatherSeries:
        series = super().get_daily(start, end)
        if self._live is None:
            return series.model_copy(
                update={"warnings": [*series.warnings, f"POWER API unreachable ({self._error}): derived series served"]}
            )
        _, location, elevation = self._live
        return series.model_copy(
            update={
                "location": location,
                "elevation_m": elevation,
                "provenance": Provenance(
                    source="NASA POWER API (MERRA-2 / CERES SYN1deg), daily, live point request",
                    data_state=DataState.MEASURED,
                    resolution="0.5 x 0.625 degree cell (MERRA-2); not an in-situ station",
                    method="Fetched live from 1981; -999 -> missing; incomplete days dropped; QA flags as pipeline",
                ),
            }
        )
