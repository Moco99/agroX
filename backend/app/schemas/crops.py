"""Crop catalog contract (catalog_v1). Numeric values may be provisional: see `verified`."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import CropType, Provenance


class PlantingWindow(BaseModel):
    start_mmdd: str
    end_mmdd: str


class GddStages(BaseModel):
    """Cumulative degree-days (C-day) from planting at which each stage starts; maturity ends LATE_SEASON."""

    initial: float = 0.0
    development: float
    mid: float
    late: float
    maturity: float

    @model_validator(mode="after")
    def monotonic(self) -> GddStages:
        if not (self.initial <= self.development <= self.mid <= self.late <= self.maturity):
            raise ValueError("gdd stage thresholds must be non-decreasing")
        return self


class StageLengthsDays(BaseModel):
    initial: int
    development: int
    mid: int
    late: int


class CanopyNdviHint(BaseModel):
    """Only used to draw an *expected canopy shape* next to observed NDVI; never simulated NDVI."""

    bare: float = 0.2
    full: float = 0.85


class CropParams(BaseModel):
    crop_id: str
    name_es: str
    name_en: str
    family: str
    crop_type: CropType
    fixes_nitrogen: bool
    cycle_days: int
    planting_window: PlantingWindow
    t_min: float
    t_opt: float
    t_max: float
    t_base_gdd: float
    t_cap_gdd: float | None = None
    gdd_stages: GddStages
    stage_lengths_days: StageLengthsDays
    water_need_mm: float | None = None
    kc_ini: float = Field(gt=0)
    kc_mid: float = Field(gt=0)
    kc_end: float = Field(gt=0)
    root_depth_min_m: float = Field(gt=0)
    root_depth_max_m: float = Field(gt=0)
    depletion_fraction_p: float = Field(gt=0, lt=1)
    canopy_ndvi_hint: CanopyNdviHint = Field(default_factory=CanopyNdviHint)
    sources: list[str] = Field(default_factory=list)
    verified: bool = False


class CropCatalog(BaseModel):
    catalog_version: str
    crops: list[CropParams]
    provenance: Provenance
    notes: list[str] = Field(default_factory=list)

    def get(self, crop_id: str) -> CropParams | None:
        return next((c for c in self.crops if c.crop_id == crop_id), None)
