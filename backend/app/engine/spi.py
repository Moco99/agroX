"""Standardized Precipitation Index (McKee et al., 1993) for one period against the same window in other years.

Gamma fit by Thom's (1958) maximum-likelihood approximation, zero totals handled with the mixed
distribution H = q + (1 - q) G, then mapped to the standard normal. Pure: no I/O, no randomness.
"""

from __future__ import annotations

import math
from statistics import NormalDist

MIN_YEARS = 30


def _gamma_p(a: float, x: float) -> float:
    """Regularized lower incomplete gamma P(a, x): series below a+1, continued fraction above."""
    if x <= 0:
        return 0.0
    gln = math.lgamma(a)
    if x < a + 1:
        term = total = 1.0 / a
        ap = a
        for _ in range(500):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-12:
                break
        return total * math.exp(-x + a * math.log(x) - gln)
    b = x + 1 - a
    c = 1e300
    d = 1 / b
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c
        c = 1e-300 if abs(c) < 1e-300 else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-12:
            break
    return 1 - math.exp(-x + a * math.log(x) - gln) * h


def spi(period_total: float, reference_totals: list[float]) -> float | None:
    """None when fewer than MIN_YEARS reference totals exist (a shorter climatology overstates confidence)."""
    if len(reference_totals) < MIN_YEARS:
        return None
    wet = [r for r in reference_totals if r > 0]
    if len(wet) < 2:
        return None
    q = 1 - len(wet) / len(reference_totals)
    mean = sum(wet) / len(wet)
    a_stat = math.log(mean) - sum(math.log(r) for r in wet) / len(wet)
    if a_stat <= 0:
        return None
    alpha = (1 + math.sqrt(1 + 4 * a_stat / 3)) / (4 * a_stat)
    beta = mean / alpha
    h = q + (1 - q) * _gamma_p(alpha, period_total / beta) if period_total > 0 else q
    # Clip so extreme years give a large finite index instead of +-inf
    h = min(max(h, 1e-6), 1 - 1e-6)
    return round(NormalDist().inv_cdf(h), 2)
