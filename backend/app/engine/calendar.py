"""Planting-date and season suggestions for any latitude (product configuration, ADR-026).

Pure functions: no I/O, no clock (`today` is an argument). They only shift the pilot calendar of
`config.DEFAULT_PLANTING_MMDD` by hemisphere; the result is a suggestion the user must verify.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from app.engine.config import (
    DEFAULT_PLANTING_MMDD,
    NORTH_SEASON_MMDD,
    SEASON_COMPLETE_LAG_DAYS,
    SOUTH_SEASON_MMDD,
    SOUTH_SHIFT_MONTHS,
    TROPICS_LAT,
)

Hemisphere = Literal["north", "south"]


def hemisphere(lat: float) -> Hemisphere:
    return "south" if lat < 0 else "north"


def is_tropical(lat: float) -> bool:
    return abs(lat) < TROPICS_LAT


def _mmdd(text: str) -> tuple[int, int]:
    month, day = (int(p) for p in text.split("-"))
    return month, day


def planting_mmdd(crop_id: str, lat: float) -> tuple[int, int]:
    """(month, day) of the suggested planting: pilot calendar, +6 months in the southern hemisphere."""
    month, day = _mmdd(DEFAULT_PLANTING_MMDD.get(crop_id, "05-10"))
    if hemisphere(lat) == "south":
        month = (month - 1 + SOUTH_SHIFT_MONTHS) % 12 + 1
    # A shifted day 29-31 must still exist in the target month (only February can be short here)
    return month, (min(day, 28) if month == 2 else day)


def suggested_planting(crop_id: str, lat: float, season_start: date) -> date:
    """Suggested planting date for a season starting at `season_start`.

    North keeps the pilot rule (same calendar year as the season start). South: the first occurrence of
    the shifted month-day on or after the season start, because southern seasons cross 1 January.
    """
    month, day = planting_mmdd(crop_id, lat)
    if hemisphere(lat) == "north":
        return date(season_start.year, month, day)
    candidate = date(season_start.year, month, day)
    return candidate if candidate >= season_start else date(season_start.year + 1, month, day)


def suggested_season(lat: float, today: date) -> tuple[date, date]:
    """Latest complete season window for the hemisphere (start, end), complete = ended before today - lag."""
    limit = today - timedelta(days=SEASON_COMPLETE_LAG_DAYS)
    if hemisphere(lat) == "north":
        (sm, sd), (em, ed) = _mmdd(NORTH_SEASON_MMDD[0]), _mmdd(NORTH_SEASON_MMDD[1])
        year = limit.year if date(limit.year, em, ed) <= limit else limit.year - 1
        return date(year, sm, sd), date(year, em, ed)
    (sm, sd), (em, ed) = _mmdd(SOUTH_SEASON_MMDD[0]), _mmdd(SOUTH_SEASON_MMDD[1])
    end_year = limit.year if date(limit.year, em, ed) <= limit else limit.year - 1
    return date(end_year - 1, sm, sd), date(end_year, em, ed)
