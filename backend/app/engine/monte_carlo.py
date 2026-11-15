"""Monte Carlo over parameter uncertainty (model 13, parameter flavour), seeded and deterministic."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from app.engine.config import STRESS_DAY_KS
from app.engine.twin import SeasonInputs, run_season
from app.schemas.common import DataState, PhenoStage
from app.schemas.twin import MonteCarloSummary

# Relative/absolute half-widths of the uniform perturbations (product configuration, not calibrated)
AWC_REL = 0.20
KC_MID_REL = 0.10
T_BASE_ABS = 1.0


def run_monte_carlo(inputs: SeasonInputs, n: int, seed: int) -> MonteCarloSummary:
    """Perturb AWC, Kc_mid and T_base with a seeded numpy Generator and report p10/p50/p90 of key outputs."""
    rng = np.random.default_rng(seed)
    mean_ks: list[float] = []
    stress_days: list[float] = []
    min_swf: list[float] = []
    for _ in range(n):
        awc = inputs.soil.awc_mm_per_m * float(rng.uniform(1 - AWC_REL, 1 + AWC_REL))
        kc_mid = inputs.crop.kc_mid * float(rng.uniform(1 - KC_MID_REL, 1 + KC_MID_REL))
        t_base = inputs.crop.t_base_gdd + float(rng.uniform(-T_BASE_ABS, T_BASE_ABS))
        soil = inputs.soil.model_copy(update={"awc_mm_per_m": awc})
        crop = inputs.crop.model_copy(update={"kc_mid": kc_mid, "t_base_gdd": t_base})
        states = run_season(replace(inputs, soil=soil, crop=crop))
        in_crop = [s for s in states if s.stage not in (PhenoStage.PRE_PLANTING, PhenoStage.HARVESTED)] or states
        ks = [s.ks for s in in_crop]
        mean_ks.append(sum(ks) / len(ks))
        stress_days.append(float(sum(1 for k in ks if k < STRESS_DAY_KS)))
        min_swf.append(min(s.soil_water_fraction for s in in_crop))

    def pct(values: list[float], q: float) -> float:
        return round(float(np.percentile(np.array(values), q)), 4)

    return MonteCarloSummary(
        n=n,
        seed=seed,
        perturbed={
            "awc_mm_per_m": f"uniform +-{AWC_REL:.0%}",
            "kc_mid": f"uniform +-{KC_MID_REL:.0%}",
            "t_base_gdd": f"uniform +-{T_BASE_ABS} C",
        },
        mean_ks_p10=pct(mean_ks, 10),
        mean_ks_p50=pct(mean_ks, 50),
        mean_ks_p90=pct(mean_ks, 90),
        stress_days_p10=pct(stress_days, 10),
        stress_days_p50=pct(stress_days, 50),
        stress_days_p90=pct(stress_days, 90),
        min_soil_water_fraction_p10=pct(min_swf, 10),
        min_soil_water_fraction_p50=pct(min_swf, 50),
        min_soil_water_fraction_p90=pct(min_swf, 90),
        data_state=DataState.SYNTHETIC if inputs.output_state is DataState.SYNTHETIC else DataState.SIMULATED,
    )
