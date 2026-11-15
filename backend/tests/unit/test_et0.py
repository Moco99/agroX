"""ET0 against FAO-56 worked examples (Allen et al. 1998) and basic properties."""

from __future__ import annotations

import math

import pytest

from app.engine import et0


def test_extraterrestrial_radiation_example_8() -> None:
    # Example 8: 3 September (J = 246) at 20 deg S -> Ra = 32.2 MJ m-2 day-1
    assert et0.extraterrestrial_radiation(-20.0, 246) == pytest.approx(32.2, abs=0.05)


def test_helpers_example_18() -> None:
    # Example 18 (Uccle, 6 July): P = 100.1 kPa, Delta = 0.122 kPa/C at 16.9 C, es = 1.997 kPa
    assert et0.atmospheric_pressure_kpa(100.0) == pytest.approx(100.1, abs=0.05)
    assert et0.slope_vapour_pressure_curve(16.9) == pytest.approx(0.122, abs=0.001)
    assert et0.mean_saturation_vapour_pressure(21.5, 12.3) == pytest.approx(1.997, abs=0.002)
    assert et0.psychrometric_constant(100.1) == pytest.approx(0.0666, abs=0.0001)


def test_penman_monteith_example_18() -> None:
    # ea = 1.409 kPa in the example (from RHmax/RHmin); POWER only has RHmean, so we pass the equivalent RHmean
    rh_mean = 1.409 / 1.997 * 100.0
    r = et0.penman_monteith(21.5, 12.3, rh_mean, 22.07, 2.078, 50.8, 100.0, 187)
    assert r.rn_mj == pytest.approx(13.28, abs=0.05)
    assert r.et0_mm == pytest.approx(3.9, abs=0.05)


@pytest.mark.parametrize("t_max,t_min,rh,rs,u2", [(-5.0, -15.0, 90.0, 3.0, 1.0), (35.0, 22.0, 30.0, 28.0, 5.0)])
def test_et0_non_negative_and_finite(t_max: float, t_min: float, rh: float, rs: float, u2: float) -> None:
    r = et0.daily_et0(t_max, t_min, rh, rs, u2, 42.0, 300.0, 200)
    assert r.et0_mm >= 0.0 and math.isfinite(r.et0_mm)


def test_hargreaves_fallback_when_inputs_missing() -> None:
    r = et0.daily_et0(30.0, 18.0, None, 25.0, 2.0, 42.0, 300.0, 200)
    assert r.method == "hargreaves"
    assert 2.0 < r.et0_mm < 9.0
    r2 = et0.daily_et0(30.0, 18.0, 60.0, float("nan"), 2.0, 42.0, 300.0, 200)
    assert r2.method == "hargreaves"
