"""Growing degree days and phenological stage (model 5 + catalog thresholds)."""

from __future__ import annotations

from app.schemas.common import PhenoStage
from app.schemas.crops import CropParams


def daily_gdd(t_max: float, t_min: float, t_base: float, t_cap: float | None) -> float:
    """GDD = max(0, (Tmax' + Tmin')/2 - Tbase).

    When `t_cap` is given the US "modified" method is used: Tmax is capped at t_cap and Tmin is floored
    at t_base before averaging (the convention used for corn; marked to-verify in the catalog).
    """
    if t_cap is not None:
        t_max = min(t_max, t_cap)
        t_min = max(t_min, t_base)
    return max(0.0, (t_max + t_min) / 2.0 - t_base)


def stage_from_gdd(gdd_cum: float, crop: CropParams, planted: bool) -> PhenoStage:
    """Map cumulative GDD since planting to the FAO-56 stage sequence."""
    if not planted:
        return PhenoStage.PRE_PLANTING
    s = crop.gdd_stages
    if gdd_cum >= s.maturity:
        return PhenoStage.HARVESTED
    if gdd_cum >= s.late:
        return PhenoStage.LATE_SEASON
    if gdd_cum >= s.mid:
        return PhenoStage.MID_SEASON
    if gdd_cum >= s.development:
        return PhenoStage.DEVELOPMENT
    return PhenoStage.INITIAL


def kc_for(gdd_cum: float, stage: PhenoStage, crop: CropParams, kc_bare: float) -> float:
    """Kc per FAO-56 stage shape: constant ini, linear ini->mid, constant mid, linear mid->end (model 3)."""
    s = crop.gdd_stages
    if stage in (PhenoStage.PRE_PLANTING, PhenoStage.HARVESTED):
        return kc_bare
    if stage is PhenoStage.INITIAL:
        return crop.kc_ini
    if stage is PhenoStage.DEVELOPMENT:
        span = max(s.mid - s.development, 1e-9)
        f = min(1.0, max(0.0, (gdd_cum - s.development) / span))
        return crop.kc_ini + f * (crop.kc_mid - crop.kc_ini)
    if stage is PhenoStage.MID_SEASON:
        return crop.kc_mid
    span = max(s.maturity - s.late, 1e-9)
    f = min(1.0, max(0.0, (gdd_cum - s.late) / span))
    return crop.kc_mid + f * (crop.kc_end - crop.kc_mid)


def root_depth_for(
    gdd_cum: float, stage: PhenoStage, crop: CropParams, max_allowed_m: float, bare_depth_m: float
) -> float:
    """Roots grow linearly from min to max depth between planting and the start of mid-season (FAO-56 ch. 8).

    After harvest the tracked layer keeps the maximum depth: shrinking it would silently delete the water
    stored below the evaporation layer and break mass conservation (decision D-TWIN-03).
    """
    if stage is PhenoStage.PRE_PLANTING:
        return min(bare_depth_m, max_allowed_m)
    if stage is PhenoStage.HARVESTED:
        return min(crop.root_depth_max_m, max_allowed_m)
    s = crop.gdd_stages
    span = max(s.mid - s.initial, 1e-9)
    f = min(1.0, max(0.0, (gdd_cum - s.initial) / span))
    depth = crop.root_depth_min_m + f * (crop.root_depth_max_m - crop.root_depth_min_m)
    return min(depth, max_allowed_m)


def canopy_index_for(stage: PhenoStage, kc: float, crop: CropParams, kc_bare: float) -> float:
    """Expected canopy *shape* in [0, 1] derived from Kc; used only to compare the shape of observed NDVI.

    This is not a simulated NDVI: it is the normalised Kc curve, which rises with canopy and falls with
    senescence, so it can be compared with the timing of observed green-up and decline.
    """
    if stage in (PhenoStage.PRE_PLANTING, PhenoStage.HARVESTED):
        return 0.0
    low = min(crop.kc_ini, kc_bare)
    span = max(crop.kc_mid - low, 1e-9)
    return min(1.0, max(0.0, (kc - low) / span))
