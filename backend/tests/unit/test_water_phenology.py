"""Water balance and phenology properties (FAO-56 ch. 8 bucket, GDD)."""

from __future__ import annotations

import pytest

from app.engine import phenology, water_balance
from app.schemas.common import IrrigationLevel


@pytest.mark.parametrize("depletion", [0.0, 50.0, 99.0, 150.0, 199.0, 200.0])
def test_ks_bounds(depletion: float) -> None:
    ks = water_balance.ks_coefficient(depletion, taw=200.0, raw=100.0)
    assert 0.0 <= ks <= 1.0
    if depletion <= 100.0:
        assert ks == 1.0


@pytest.mark.parametrize(
    "prev,precip,et0,level",
    [
        (10.0, 0.0, 6.0, IrrigationLevel.NONE),
        (150.0, 0.0, 8.0, IrrigationLevel.NONE),
        (210.0, 0.0, 9.0, IrrigationLevel.NONE),
        (5.0, 60.0, 2.0, IrrigationLevel.NONE),
        (120.0, 3.0, 5.0, IrrigationLevel.HIGH),
    ],
)
def test_daily_mass_conservation(prev: float, precip: float, et0: float, level: IrrigationLevel) -> None:
    step = water_balance.step(prev, 176.0, 1.2, 0.55, precip, et0, 1.2, level, "C/D")
    start = min(max(prev, 0.0), step.taw_mm)
    # FAO-56 eq. 85 rearranged: delta Dr = ETc_adj - (P - RO) - I + DP
    lhs = step.depletion_mm - start
    rhs = step.etc_adj_mm - step.effective_precip_mm - step.irrigation_mm + step.drainage_mm
    assert lhs == pytest.approx(rhs, abs=1e-9)
    assert 0.0 <= step.depletion_mm <= step.taw_mm + 1e-9
    assert step.runoff_mm + step.effective_precip_mm == pytest.approx(precip)


def test_irrigation_only_when_triggered() -> None:
    wet = water_balance.step(10.0, 176.0, 1.2, 0.55, 0.0, 5.0, 1.0, IrrigationLevel.HIGH, None)
    dry = water_balance.step(150.0, 176.0, 1.2, 0.55, 0.0, 5.0, 1.0, IrrigationLevel.HIGH, None)
    none = water_balance.step(150.0, 176.0, 1.2, 0.55, 0.0, 5.0, 1.0, IrrigationLevel.NONE, None)
    assert wet.irrigation_mm == 0.0 and dry.irrigation_mm > 0.0 and none.irrigation_mm == 0.0


def test_gdd_capped_and_non_negative() -> None:
    assert phenology.daily_gdd(5.0, -3.0, 10.0, 30.0) == 0.0
    # Modified method: Tmax capped at 30, Tmin floored at 10 -> (30 + 10)/2 - 10 = 10
    assert phenology.daily_gdd(38.0, 5.0, 10.0, 30.0) == pytest.approx(10.0)
    assert phenology.daily_gdd(20.0, 10.0, 0.0, None) == pytest.approx(15.0)
