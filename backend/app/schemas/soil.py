"""Soil contract: what the FAO-56 water balance needs per zone."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import Provenance


class SoilProfile(BaseModel):
    awc_mm_per_m: float = Field(gt=0, description="available water capacity, mm of water per m of soil")
    root_depth_max_m: float = Field(gt=0, description="restrictive depth for roots (bedrock/water table)")
    texture: str | None = None
    drainage_class: str | None = None
    hydrologic_group: str | None = None
    map_unit_name: str | None = None
    component_name: str | None = None
    provenance: Provenance
    verified: bool = False
    warnings: list[str] = Field(default_factory=list)
