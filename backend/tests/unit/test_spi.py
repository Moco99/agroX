"""SPI engine: gamma CDF against closed forms and basic index behaviour."""

import math

from app.engine.spi import _gamma_p, spi


def test_gamma_p_matches_exponential_closed_form() -> None:
    # P(1, x) = 1 - e^-x for both branches (x < a+1 and x >= a+1)
    for x in (0.3, 1.5, 4.0, 12.0):
        assert abs(_gamma_p(1.0, x) - (1 - math.exp(-x))) < 1e-9


def test_spi_behaviour() -> None:
    ref = [400.0 + 10 * i for i in range(40)]
    assert spi(500.0, ref[:29]) is None
    assert abs(spi(sum(ref) / len(ref), ref) or 0) < 0.2
    assert (spi(250.0, ref) or 0) < -2
    assert (spi(800.0, ref) or 0) > 1.5
