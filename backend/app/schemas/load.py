"""Staged loading of a farm whose sources are slow (live mode): what is ready, what is still coming."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import DataState

StageName = Literal["terrain", "soil", "weather", "ndvi", "land_cover", "basemap", "heightmap"]
# provisional = the endpoint answers with a marked stand-in (e.g. soil AWC 150 mm/m) while the source is retried
StageStatus = Literal["pending", "running", "ready", "provisional", "failed", "skipped"]
LoadState = Literal["not_started", "loading", "ready"]


class LoadStage(BaseModel):
    stage: StageName
    status: StageStatus
    # Optional stages (imagery, land cover) never hold the farm back from "ready"
    required: bool
    message: str | None = None
    elapsed_s: float | None = Field(default=None, ge=0)
    # Seconds until the backend retries a failed/provisional source on its own (negative-cache expiry)
    retry_after_s: float | None = Field(default=None, ge=0)
    attempts: int = 0
    data_state: DataState | None = None


class FarmLoadStatus(BaseModel):
    farm_id: str
    data_mode: str
    state: LoadState
    # Share of stages that reached a final status (ready / provisional / failed / skipped)
    progress: float = Field(ge=0, le=1)
    # False while the soil is the provisional stand-in: refresh farm + twin when it turns True
    soil_final: bool
    stages: list[LoadStage]
    # Suggested polling interval; None once nothing is running
    poll_after_s: float | None = None
    # Stages that ended in "failed" (state can still be "ready": optional ones, or required ones awaiting retry)
    failed_stages: list[StageName] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
