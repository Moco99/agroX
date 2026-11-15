"""EcoCrop-RF rotation request (moved out of the router so every request body lives in schemas/)."""

from __future__ import annotations

from app.schemas.common import StrictRequest


class RotationRecommendRequest(StrictRequest):
    t_mean: float = 22.0
    rain_mm: float = 650.0
    soil_ph: float = 6.5
    soil_awc: float = 140.0
    t_extreme_days: int = 4
    cycles: int = 3
    top_k: int = 3
