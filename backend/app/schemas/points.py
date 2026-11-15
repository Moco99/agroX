"""Historical source queries for a user-selected geographic point."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from app.schemas.common import DataState


class PointQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    start: date | None = None
    end: date | None = None
    refresh: bool = False

    @model_validator(mode="after")
    def historical_period(self) -> PointQuery:
        self.lat = round(self.lat, 5)
        self.lon = round(self.lon, 5)
        self.end = self.end or date.today() - timedelta(days=7)
        self.start = self.start or self.end - timedelta(days=730)
        if self.start > self.end or (self.end - self.start).days > 730:
            raise ValueError("Period must be ordered and span at most 730 days")
        if self.end > date.today():
            raise ValueError("Historical queries cannot include future dates")
        return self


class QueryPoint(BaseModel):
    lat: float
    lon: float


class QueryPeriod(BaseModel):
    start: date
    end: date


class PointSection(BaseModel):
    status: Literal["ok", "error"]
    data: dict[str, JsonValue] | None
    error: str | None
    source: str
    data_state: DataState
    elapsed_s: float = Field(ge=0)


class PointSections(BaseModel):
    coverage: PointSection
    terrain: PointSection
    soil: PointSection
    climate: PointSection
    vegetation: PointSection
    suitability: PointSection


class PointResponse(BaseModel):
    point: QueryPoint
    period: QueryPeriod
    sections: PointSections
    note: str = "Historical datasets queried on demand; not real-time field measurements."
