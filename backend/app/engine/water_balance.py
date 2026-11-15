"""FAO-56 chapter 8 root-zone water balance, one explicit daily step (model 4)."""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.config import (
    IRRIGATION_RULES,
    RUNOFF_COEFF_BY_HYDGRP,
    RUNOFF_COEFF_DEFAULT,
    RUNOFF_THRESHOLD_MM,
    IrrigationRule,
)
from app.schemas.common import IrrigationLevel


@dataclass(frozen=True)
class WaterState:
    depletion_mm: float
    taw_mm: float
    raw_mm: float


@dataclass(frozen=True)
class WaterStep:
    depletion_mm: float
    taw_mm: float
    raw_mm: float
    ks: float
    etc_mm: float
    etc_adj_mm: float
    effective_precip_mm: float
    runoff_mm: float
    irrigation_mm: float
    drainage_mm: float


def runoff_coefficient(hydrologic_group: str | None) -> float:
    """Hydrologic group letters like 'C/D' (dual) take the drained class first letter."""
    if not hydrologic_group:
        return RUNOFF_COEFF_DEFAULT
    key = hydrologic_group.strip().upper()[:1]
    return RUNOFF_COEFF_BY_HYDGRP.get(key, RUNOFF_COEFF_DEFAULT)


def runoff_mm(precip_mm: float, coeff: float) -> float:
    """Simple documented rule: a fraction of rain above a threshold runs off (CR = 0 in MVP)."""
    return coeff * max(0.0, precip_mm - RUNOFF_THRESHOLD_MM)


def taw_mm(awc_mm_per_m: float, root_depth_m: float) -> float:
    """TAW = AWC[mm/m] x Zr[m] (FAO-56 eq. 82 with AWC = 1000 (theta_FC - theta_WP))."""
    return awc_mm_per_m * root_depth_m


def ks_coefficient(depletion_mm: float, taw: float, raw: float) -> float:
    """FAO-56 eq. 84: Ks = (TAW - Dr) / ((1 - p) TAW) when Dr > RAW, else 1."""
    if depletion_mm <= raw:
        return 1.0
    denom = taw - raw
    if denom <= 0:
        return 0.0
    return max(0.0, min(1.0, (taw - depletion_mm) / denom))


def irrigation_for(depletion_mm: float, raw: float, rule: IrrigationRule) -> float:
    """Apply a fixed depth once depletion exceeds the rule's trigger (product configuration, O-15)."""
    if rule.depth_mm <= 0:
        return 0.0
    return rule.depth_mm if depletion_mm >= rule.trigger_fraction_of_raw * raw else 0.0


def step(
    previous_depletion_mm: float,
    awc_mm_per_m: float,
    root_depth_m: float,
    p_fraction: float,
    precip_mm: float,
    et0_mm: float,
    kc: float,
    irrigation_level: IrrigationLevel,
    hydrologic_group: str | None,
) -> WaterStep:
    """One day of FAO-56 eq. 85: Dr_i = Dr_{i-1} - (P - RO) - I - CR + ETc_adj + DP, bounded to [0, TAW].

    Ks is evaluated on the depletion at the *start* of the day (FAO-56 recommendation), ETc_adj = Ks Kc ET0.
    Irrigation is decided on the start-of-day depletion too. Water above field capacity drains (DP).
    """
    taw = taw_mm(awc_mm_per_m, root_depth_m)
    raw = p_fraction * taw
    # Root growth enlarges TAW while depletion is kept in mm: the newly explored layer enters at field
    # capacity (FAO-56 ch. 8 simplification). TAW never shrinks inside a season, so the clip is a no-op guard.
    depletion = min(max(previous_depletion_mm, 0.0), taw)
    ks = ks_coefficient(depletion, taw, raw)
    etc = kc * et0_mm
    ro = runoff_mm(precip_mm, runoff_coefficient(hydrologic_group))
    effective = precip_mm - ro
    irrigation = irrigation_for(depletion, raw, IRRIGATION_RULES[irrigation_level])
    # Ks is evaluated at the start of the day, so on a dry day ETc_adj could overshoot the water left above
    # the wilting point; capping ET (instead of clipping depletion afterwards) keeps the balance mass-conserving
    etc_adj = min(ks * etc, max(0.0, taw - depletion + effective + irrigation))
    new_depletion = depletion - effective - irrigation + etc_adj
    drainage = 0.0
    if new_depletion < 0.0:
        drainage = -new_depletion
        new_depletion = 0.0
    return WaterStep(
        depletion_mm=new_depletion,
        taw_mm=taw,
        raw_mm=raw,
        ks=ks,
        etc_mm=etc,
        etc_adj_mm=etc_adj,
        effective_precip_mm=effective,
        runoff_mm=ro,
        irrigation_mm=irrigation,
        drainage_mm=drainage,
    )
