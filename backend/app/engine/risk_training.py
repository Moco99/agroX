"""Reproducible synthetic risk data and training configuration.

The oracle is an internal product heuristic, never an observed field outcome.
Profile groups represent synthetic cycle/demand combinations, not real farms.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

FEATURE_NAMES = (
    "t_mean",
    "t_extreme_ratio",
    "rain_mm",
    "rain_deficit_ratio",
    "soil_ph",
    "soil_awc",
    "cycle_days",
    "crop_water_need",
    "is_same_family",
    "is_legume_preceding",
)
DATA_VERSION = "synthetic_stress_v1"
CONFIG_PATH = Path(__file__).with_name("risk_model_config.json")
BASELINE_PARAMS = {
    "n_estimators": 120,
    "max_depth": 12,
    "min_samples_leaf": 3,
    "max_features": "sqrt",
    "class_weight": None,
    "max_samples": None,
}


@dataclass(frozen=True)
class RiskDataset:
    features: np.ndarray
    labels: np.ndarray
    oracle_labels: np.ndarray
    groups: np.ndarray


def make_risk_dataset(n_samples: int = 12000, seed: int = 42, profile: str = "development") -> RiskDataset:
    """Generate coherent features, noisy training labels and a noiseless reference.

    Development preserves the original RNG sequence for a fair baseline.
    Other profiles are reserved for final evaluation, never parameter selection.
    """
    if type(n_samples) is not int or n_samples < 1:
        raise ValueError("n_samples must be a positive integer")
    if profile not in {"development", "iid", "unseen_profiles", "shifted_drought", "shifted_wet"}:
        raise ValueError("Unknown validation profile")
    rng = np.random.RandomState(seed)
    shifted = profile.startswith("shifted_")
    t_mean = rng.uniform(34.0, 42.0, n_samples) if shifted else rng.uniform(8.0, 34.0, n_samples)
    extreme_ratio = rng.uniform(0.0, 1.0, n_samples)
    rng.uniform(200.0, 1600.0, n_samples)  # Preserve legacy development RNG consumption.
    soil_ph = rng.uniform(5.0, 8.2, n_samples)
    soil_awc = rng.uniform(80.0, 220.0, n_samples)
    novel = profile not in {"development", "iid"}
    cycles = rng.choice([85, 105, 145, 165] if novel else [75, 90, 110, 130, 150, 180], n_samples)
    demand = rng.choice([425, 575, 725, 950] if novel else [350, 500, 650, 800, 1100], n_samples)
    same_family = rng.binomial(1, 0.35, n_samples)
    legume = rng.binomial(1, 0.45, n_samples)
    rain = demand * rng.uniform(0.0, 1.6, n_samples)
    if profile == "shifted_drought":
        rain = demand * rng.uniform(0.0, 0.55, n_samples)
        soil_awc = rng.uniform(40.0, 100.0, n_samples)
        extreme_ratio = rng.beta(3.0, 1.2, n_samples)
    elif profile == "shifted_wet":
        rain = demand * rng.uniform(1.6, 2.5, n_samples)
        soil_awc = rng.uniform(220.0, 300.0, n_samples)
        extreme_ratio = rng.beta(1.2, 4.0, n_samples)
    extreme_ratio = np.rint(extreme_ratio * cycles) / cycles
    deficit = np.maximum(0.0, (demand - rain) / demand)
    features = np.column_stack(
        [
            t_mean,
            extreme_ratio,
            rain,
            deficit,
            soil_ph,
            soil_awc,
            cycles,
            demand,
            same_family,
            legume,
        ]
    )
    stress = (
        0.40 * deficit + 0.30 * extreme_ratio + 0.15 * (1.0 - soil_awc / 220.0) + 0.15 * same_family - 0.10 * legume
    )
    oracle = np.select([stress < 0.30, stress < 0.58], [0, 1], default=2)
    noisy = stress + rng.normal(0, 0.05, n_samples)
    labels = np.select([noisy < 0.30, noisy < 0.58], [0, 1], default=2)
    groups = np.array([f"{cycle}:{need}" for cycle, need in zip(cycles, demand, strict=True)])
    return RiskDataset(features, labels, oracle, groups)


def load_training_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {
            "data_version": DATA_VERSION,
            "samples": 12000,
            "seed": 42,
            "params": BASELINE_PARAMS.copy(),
            "selection": "legacy_defaults",
        }
    config: dict[str, Any] = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config["data_version"] != DATA_VERSION or tuple(config["feature_names"]) != FEATURE_NAMES:
        raise ValueError("Risk training configuration does not match the data/feature schema")
    return config
