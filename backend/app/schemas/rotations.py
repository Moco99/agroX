"""Validated rotation request for an actual farm and historical climate window."""

from __future__ import annotations

from datetime import date

from pydantic import Field, model_validator

from app.schemas.common import StrictRequest, Weights


class RotationScenario(StrictRequest):
    temp_delta_c: float = Field(default=0, ge=-15, le=15)
    precip_factor: float = Field(default=1, ge=0, le=3)


class RotationWindow(StrictRequest):
    start: date
    end: date


class RotationRecommendRequest(StrictRequest):
    farm_id: str = Field(min_length=1, max_length=100)
    start: date
    end: date
    soil_ph: float | None = Field(default=None, ge=0, le=14)
    cycles: int = Field(default=3, ge=2, le=4, strict=True)
    cycle_windows: list[RotationWindow] | None = Field(default=None, min_length=2, max_length=4)
    twin_only: bool = False
    top_k: int = Field(default=3, ge=1, le=10, strict=True)
    previous_crop: str | None = Field(default=None, max_length=30)
    # First cycle is fixed to this crop (validated against the engine catalog); None = automatic
    start_crop: str | None = Field(default=None, max_length=30)
    exclude_same_family: bool = False
    weights: Weights = Field(default_factory=lambda: Weights(water=1, soil=1, climate=1))
    scenario: RotationScenario = Field(default_factory=RotationScenario)

    @model_validator(mode="after")
    def validate_period(self) -> RotationRecommendRequest:
        if self.end < self.start or (self.end - self.start).days > 730:
            raise ValueError("Period must be ordered and at most 731 days")
        if self.cycle_windows is not None:
            if len(self.cycle_windows) != self.cycles:
                raise ValueError("Indica exactamente un periodo por ciclo")
            for index, window in enumerate(self.cycle_windows):
                if not self.start <= window.start <= window.end <= self.end:
                    raise ValueError("Cada ciclo debe quedar dentro del periodo de referencia")
                if (window.end - window.start).days >= 366:
                    raise ValueError("Cada ciclo admite hasta 366 días")
                if index and self.cycle_windows[index - 1].end >= window.start:
                    raise ValueError("Los ciclos deben estar ordenados y no solaparse")
        return self
