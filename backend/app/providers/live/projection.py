"""ProjectionProvider: daily CMIP6 climate projections (NEX-GDDP-CMIP6) from the NASA POWER Climate Projection API.

One climate model and one SSP scenario per request, whole calendar years, cached on disk forever (a projection
does not change). The response is converted to the twin's canonical WeatherDay units:

- ALLSKY_SFC_SW_DWN: the JSON metadata says "MJ/m^2/day" but the values are W/m^2 (verified 2026-11-15: annual
  means ~200-250 where POWER's historical API gives 15-20 MJ/m^2/day), so they are multiplied by 0.0864.
  If the yearly mean is already MJ-sized (< 50) the values are kept, so a fix upstream cannot be double-converted.
- WS10M (wind at 10 m; WS2M is not offered) -> 2 m with FAO-56 eq. 47.
- Missing days (-999 or absent): the API drops a run of late-December days every year (1-30 days, same dates for
  every model and scenario) and 29 February for 365-day-calendar models. Short gaps are interpolated like the
  reference-year logic; longer ones take the mean of the model's own days around the gap. All are flagged.
"""

from __future__ import annotations

import json
import math
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path

from app.engine.config import PROJECTION_GAP_WINDOW_DAYS, REFERENCE_MAX_FILL_DAYS
from app.providers.ports import UpstreamUnavailableError
from app.schemas.common import DataState, Location, Provenance
from app.schemas.weather import WeatherDay, WeatherSeries

# ─────────────────────────────────────────
# Section: Constants (verified against the live API on 2026-11-15, v2.6.4-beta)
# ─────────────────────────────────────────

PROJECTION_URL = "https://power.larc.nasa.gov/api/projection/daily/point"
PROJECTION_SOURCE = "NASA POWER Climate Projection API (NEX-GDDP-CMIP6)"
PARAMS = {
    "T2M": "t_mean",
    "T2M_MAX": "t_max",
    "T2M_MIN": "t_min",
    "PRECTOTCORR": "precip",
    "RH2M": "rh_mean",
    "ALLSKY_SFC_SW_DWN": "solar_rad",
    "WS10M": "wind_2m",
}
SCENARIOS = ("ssp126", "ssp245", "ssp370")
# Models the daily endpoint serves with every variable the twin needs (verified 2026-11-15, three scenarios):
# the other 16 names it lists answer "not available"; cesm2 has no T2M_MAX/T2M_MIN and giss_e2_1_g no T2M_MIN
DAILY_MODELS = ("ec_earth3", "gfdl_esm4", "ipsl_cm6a_lr", "mpi_esm1_2_lr")
# Days covered by the SSP runs: the API rejects dates before 2015 (historical runs) or after 2100
FIRST_DAY, LAST_DAY = date(2015, 1, 1), date(2100, 12, 31)
MISSING = -999.0
FILLED_FLAG = "projection_gap_filled"
# 1 W/m^2 sustained for a day = 86400 J/m^2 = 0.0864 MJ/m^2
W_M2_TO_MJ_DAY = 0.0864
# FAO-56 eq. 47: u2 = uz * 4.87 / ln(67.8 z - 5.42), z = 10 m
WIND_10M_TO_2M = 4.87 / math.log(67.8 * 10.0 - 5.42)
# A yearly mean daily radiation above this cannot be MJ/m^2/day (the solar constant gives ~45 at most)
MJ_PLAUSIBLE_MAX = 50.0
TIMEOUT_S = 30
RETRY_AFTER_FAILURE_S = 120

ProjectionJson = dict[str, object]


class ProjectionNoDataError(ValueError):
    """The API answered, but has no values at this point (ocean or outside its region)."""


Fetcher = Callable[[float, float, str, str, date, date], ProjectionJson]


# ─────────────────────────────────────────
# Section: Fetch
# ─────────────────────────────────────────


def fetch_projection(lat: float, lon: float, model: str, scenario: str, start: date, end: date) -> ProjectionJson:
    query = urllib.parse.urlencode(
        {
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "latitude": lat,
            "longitude": lon,
            "community": "ag",
            "parameters": ",".join(PARAMS),
            "format": "json",
            "model": model,
            "scenario": scenario,
        }
    )
    req = urllib.request.Request(f"{PROJECTION_URL}?{query}", headers={"User-Agent": "agrox-backend"})
    last: Exception | None = None
    # One retry for transient failures; a 4xx (model not served, bad range) will not change by retrying
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                data = json.loads(resp.read())
            if not isinstance(data, dict) or "properties" not in data:
                raise ValueError(f"unexpected response: {str(data)[:160]}")
            return data
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        if attempt == 0:
            time.sleep(1.0)
    assert last is not None
    raise last


# ─────────────────────────────────────────
# Section: Parse, convert and fill
# ─────────────────────────────────────────

Row = dict[str, float | None]


def _rows(data: ProjectionJson, scenario: str) -> tuple[dict[date, Row], bool]:
    """Raw values per date (None = missing) in canonical units, and whether radiation came in W/m^2."""
    props = data["properties"]
    assert isinstance(props, dict)
    params = props["parameter"]
    assert isinstance(params, dict)
    by_param: dict[str, dict[str, float]] = {}
    for name in PARAMS:
        block = params.get(name)
        if not isinstance(block, dict) or not isinstance(block.get(scenario), dict):
            raise ValueError(f"projection response lacks {name}/{scenario}")
        by_param[name] = block[scenario]
    # NEX-GDDP is land-only and the beta API serves a limited region: a point outside it is all -999
    if all(float(v) == MISSING for v in by_param["T2M"].values()):
        raise ProjectionNoDataError("no projection data at this point")
    absent = [name for name, values in by_param.items() if all(float(v) == MISSING for v in values.values())]
    if absent:
        raise ValueError(f"model does not provide {', '.join(absent)}")
    rad_valid = [float(v) for v in by_param["ALLSKY_SFC_SW_DWN"].values() if float(v) != MISSING]
    in_w_m2 = bool(rad_valid) and statistics.fmean(rad_valid) > MJ_PLAUSIBLE_MAX
    rows: dict[date, Row] = {}
    for key in by_param["T2M"]:
        row: Row = {}
        for name, field in PARAMS.items():
            raw = by_param[name].get(key)
            value = None if raw is None or float(raw) == MISSING else float(raw)
            if value is not None and name == "ALLSKY_SFC_SW_DWN" and in_w_m2:
                value *= W_M2_TO_MJ_DAY
            elif value is not None and name == "WS10M":
                value *= WIND_10M_TO_2M
            elif value is not None and name == "RH2M":
                value = min(100.0, max(0.0, value))
            elif value is not None and name == "PRECTOTCORR":
                value = max(0.0, value)
            row[field] = value
        rows[date(int(key[:4]), int(key[4:6]), int(key[6:]))] = row
    return rows, in_w_m2


def _complete(row: Row | None) -> bool:
    return row is not None and all(v is not None for v in row.values())


def _fill_gap(rows: dict[date, Row], first: date, last: date) -> None:
    """Interpolate a short gap between its neighbours; a longer one takes the mean of the days around it."""
    length = (last - first).days + 1
    before, after = rows.get(first - timedelta(days=1)), rows.get(last + timedelta(days=1))
    fields = list(PARAMS.values())
    if length <= REFERENCE_MAX_FILL_DAYS and _complete(before) and _complete(after):
        assert before is not None and after is not None
        for i in range(length):
            w = (i + 1) / (length + 1)
            rows[first + timedelta(days=i)] = {
                f: float(before[f] or 0.0) + (float(after[f] or 0.0) - float(before[f] or 0.0)) * w for f in fields
            }
        return
    window = [rows.get(first - timedelta(days=k)) for k in range(1, PROJECTION_GAP_WINDOW_DAYS + 1)] + [
        rows.get(last + timedelta(days=k)) for k in range(1, PROJECTION_GAP_WINDOW_DAYS + 1)
    ]
    usable = [r for r in window if _complete(r)]
    if len(usable) < 5:
        raise ValueError(f"no usable days around the gap {first}..{last}")
    mean = {f: statistics.fmean(float(r[f] or 0.0) for r in usable if r is not None) for f in fields}
    for i in range(length):
        rows[first + timedelta(days=i)] = dict(mean)


def parse_projection(
    data: ProjectionJson, scenario: str, start: date, end: date
) -> tuple[WeatherSeries, list[tuple[date, date]], bool]:
    """API JSON -> complete WeatherSeries for start..end, the filled gaps and whether radiation was in W/m^2."""
    rows, in_w_m2 = _rows(data, scenario)
    gaps: list[tuple[date, date]] = []
    day = start
    while day <= end:
        if _complete(rows.get(day)):
            day += timedelta(days=1)
            continue
        first = day
        while day <= end and not _complete(rows.get(day)):
            day += timedelta(days=1)
        gaps.append((first, day - timedelta(days=1)))
    filled: set[date] = set()
    for first, last in gaps:
        _fill_gap(rows, first, last)
        filled.update(first + timedelta(days=i) for i in range((last - first).days + 1))
    days: list[WeatherDay] = []
    day = start
    while day <= end:
        r = rows[day]
        days.append(
            WeatherDay(
                date=day,
                t_mean=float(r["t_mean"] or 0.0),
                t_max=float(r["t_max"] or 0.0),
                t_min=float(r["t_min"] or 0.0),
                precip=float(r["precip"] or 0.0),
                rh_mean=float(r["rh_mean"] or 0.0),
                solar_rad=float(r["solar_rad"] or 0.0),
                wind_2m=float(r["wind_2m"] or 0.0),
                qa_flags=[FILLED_FLAG] if day in filled else [],
            )
        )
        day += timedelta(days=1)
    geometry = data["geometry"]
    assert isinstance(geometry, dict)
    coords = geometry["coordinates"]
    assert isinstance(coords, list)
    header = data.get("header")
    model = str(header.get("model")) if isinstance(header, dict) else "?"
    series = WeatherSeries(
        location=Location(lat=float(coords[1]), lon=float(coords[0])),
        elevation_m=float(coords[2]),
        days=days,
        provenance=Provenance(
            source=PROJECTION_SOURCE,
            data_state=DataState.SIMULATED,
            version=f"model {model}, scenario {scenario}",
            resolution="0.25 degree NEX-GDDP-CMIP6 cell (bias-corrected, statistically downscaled); not a station",
            method=conversions_text(in_w_m2)
            + (f"; {len(filled)} missing day(s) filled and flagged ({FILLED_FLAG})" if filled else ""),
        ),
    )
    return series, gaps, in_w_m2


def conversions_text(in_w_m2: bool) -> str:
    rad = "ALLSKY_SFC_SW_DWN W/m^2 x 0.0864 -> MJ/m^2/day" if in_w_m2 else "ALLSKY_SFC_SW_DWN kept as MJ/m^2/day"
    return f"{rad}; WS10M x {WIND_10M_TO_2M:.3f} -> wind at 2 m (FAO-56 eq. 47)"


# ─────────────────────────────────────────
# Section: Provider
# ─────────────────────────────────────────


class ProjectionProvider:
    """Fetches whole calendar years per (point, model, scenario) and serves any window inside them."""

    def __init__(self, cache_dir: Path, fetcher: Fetcher = fetch_projection) -> None:
        self._cache_dir = cache_dir / "projection"
        self._fetcher = fetcher
        # Recent failures per key: without this every request re-paid the timeout while the beta API is down
        self._failed: dict[str, tuple[float, str]] = {}

    def series(
        self, lat: float, lon: float, model: str, scenario: str, start: date, end: date
    ) -> tuple[WeatherSeries, list[tuple[date, date]], bool]:
        if model not in DAILY_MODELS or scenario not in SCENARIOS:
            raise ValueError(f"unsupported model/scenario {model}/{scenario}")
        # Whole years plus a margin so a gap at the edge of the window still has neighbours to fill from
        margin = timedelta(days=PROJECTION_GAP_WINDOW_DAYS)
        y0 = max(FIRST_DAY, start - margin).year
        y1 = min(LAST_DAY, end + margin).year
        lat, lon = round(lat, 2), round(lon, 2)
        key = f"{lat}_{lon}_{model}_{scenario}_{y0}_{y1}"
        cache = self._cache_dir / f"{key}.json"
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            failed = self._failed.get(key)
            if failed and time.time() - failed[0] < RETRY_AFTER_FAILURE_S:
                raise UpstreamUnavailableError(failed[1])
            try:
                data = self._fetcher(lat, lon, model, scenario, date(y0, 1, 1), date(y1, 12, 31))
            except Exception as exc:
                message = f"{type(exc).__name__}: {str(exc)[:160]}"
                self._failed[key] = (time.time(), message)
                raise UpstreamUnavailableError(message) from exc
            self._failed.pop(key, None)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(data), encoding="utf-8")
        return parse_projection(data, scenario, start, end)
