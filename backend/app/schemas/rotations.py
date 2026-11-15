"""Validated rotation request for an actual farm and historical climate window."""

from __future__ import annotations

from datetime import date

from pydantic import Field, model_validator

from app.schemas.common import StrictRequest, Weights


class RotationScenario(StrictRequest):
    temp_delta_c: float = Field(default=0, ge=-15, le=15)
    precip_factor: float = Field(default=1, ge=0, le=3)


class RotationRecommendRequest(StrictRequest):
    farm_id: str = Field(min_length=1, max_length=100)
    start: date
    end: date
    soil_ph: float | None = Field(default=None, ge=0, le=14)
    cycles: int = Field(default=3, ge=2, le=4, strict=True)
    top_k: int = Field(default=3, ge=1, le=10, strict=True)
    previous_crop: str | None = Field(default=None, max_length=30)
    exclude_same_family: bool = False
    weights: Weights = Field(default_factory=lambda: Weights(water=1, soil=1, climate=1))
    scenario: RotationScenario = Field(default_factory=RotationScenario)

    @model_validator(mode="after")
    def validate_period(self) -> RotationRecommendRequest:
        if self.end < self.start or (self.end - self.start).days > 730:
            raise ValueError("Period must be ordered and at most 731 days")
        return self
