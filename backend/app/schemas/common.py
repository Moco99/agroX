"""Shared enums and base models used by every contract."""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field, model_validator

# ─────────────────────────────────────────
# Section: Enums
# ─────────────────────────────────────────


class DataState(str, Enum):
    MEASURED = "MEASURED"
    DECLARED = "DECLARED"
    ESTIMATED = "ESTIMATED"
    SIMULATED = "SIMULATED"
    SYNTHETIC = "SYNTHETIC"


class TwinLevel(str, Enum):
    DIGITAL_MODEL = "DIGITAL_MODEL"
    DIGITAL_SHADOW = "DIGITAL_SHADOW"
    DIGITAL_TWIN = "DIGITAL_TWIN"


class PhenoStage(str, Enum):
    PRE_PLANTING = "PRE_PLANTING"
    INITIAL = "INITIAL"
    DEVELOPMENT = "DEVELOPMENT"
    MID_SEASON = "MID_SEASON"
    LATE_SEASON = "LATE_SEASON"
    HARVESTED = "HARVESTED"


class CropType(str, Enum):
    CASH_CROP = "CASH_CROP"
    COVER_CROP = "COVER_CROP"


class IrrigationLevel(str, Enum):
    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class StressClass(str, Enum):
    """Classification of the water-stress coefficient Ks (thresholds are product configuration)."""

    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class RecommendationStatus(str, Enum):
    PRELIMINARY = "PRELIMINARY"
    VERIFIED_INPUTS = "VERIFIED_INPUTS"


# ─────────────────────────────────────────
# Section: Base models
# ─────────────────────────────────────────


class Provenance(BaseModel):
    source: str = Field(description="e.g. 'NASA POWER', 'synthetic:weather_v1'")
    data_state: DataState
    retrieved_at: date | None = None
    version: str | None = None
    resolution: str | None = None
    method: str | None = None


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Weights(BaseModel):
    water: float = Field(ge=0)
    soil: float = Field(ge=0)
    climate: float = Field(ge=0)

    # Users send any non-negative mix; the engine always works with weights summing to 1
    @model_validator(mode="after")
    def normalize(self) -> Weights:
        total = self.water + self.soil + self.climate
        if total <= 0:
            raise ValueError("at least one weight must be positive")
        self.water, self.soil, self.climate = (self.water / total, self.soil / total, self.climate / total)
        return self


class Metric(BaseModel):
    """A single exposed number always travels with its unit and data_state."""

    value: float | None
    unit: str
    data_state: DataState
    source: str | None = None
