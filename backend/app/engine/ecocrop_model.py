"""EcoCrop-RF Hybrid Agro-Climatic Suitability & Rotation Model.

Combines FAO EcoCrop bio-physical tolerance thresholds (ecocrop.parquet)
with a Random Forest classifier for environmental stress risk prediction
and a multi-objective crop rotation recommender.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .risk_training import FEATURE_NAMES, load_training_config, make_risk_dataset

REPO_ROOT = Path(__file__).resolve().parents[3]
ECOCROP_PARQUET = REPO_ROOT / "ecocrop.parquet"


def trapezoidal_suitability(val: float, min_val: float, opt_min: float, opt_max: float, max_val: float) -> float:
    """Calculate FAO EcoCrop trapezoidal membership score [0, 100].

    - 100%: Between opt_min and opt_max.
    - 0%: Less than min_val or greater than max_val.
    - Linear interpolation between boundaries.
    """
    values = (val, min_val, opt_min, opt_max, max_val)
    if any(not pd.isna(v) and not math.isfinite(float(v)) for v in values):
        raise ValueError("Suitability inputs must be finite or NaN")
    if pd.isna(val) or pd.isna(min_val) or pd.isna(max_val):
        return 50.0  # Unknown; score_crop exposes an incomplete-data warning.
    opt_min = min_val if pd.isna(opt_min) else opt_min
    opt_max = max_val if pd.isna(opt_max) else opt_max
    if not min_val <= opt_min <= opt_max <= max_val:
        raise ValueError("Suitability thresholds must be ordered min <= optimal min <= optimal max <= max")

    if val < min_val or val > max_val:
        return 0.0
    if opt_min <= val <= opt_max:
        return 100.0
    if min_val <= val < opt_min:
        return 100.0 * (val - min_val) / max(opt_min - min_val, 1e-4)
    if opt_max < val <= max_val:
        return 100.0 * (max_val - val) / max(max_val - opt_max, 1e-4)
    return 0.0


class EcoCropEngine:
    """In-memory query and scoring engine for FAO EcoCrop species."""

    def __init__(self, parquet_path: Path | None = None):
        self.path = parquet_path or ECOCROP_PARQUET
        self._df: pd.DataFrame | None = None
        self._load_dataset()

    def _load_dataset(self) -> None:
        if not self.path.exists():
            raise FileNotFoundError(f"EcoCrop parquet file not found at: {self.path}")
        self._df = pd.read_parquet(self.path)

    @property
    def df(self) -> pd.DataFrame:
        if self._df is None:
            self._load_dataset()
        assert self._df is not None
        return self._df

    def find_crops(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search crops by common name or scientific name."""
        q = query.strip().lower()
        df = self.df
        mask = df["scientificname"].str.lower().str.contains(q, na=False, regex=False) | df["comname"].astype(
            str
        ).str.lower().str.contains(q, na=False, regex=False)
        sub = df[mask].head(limit)
        results = []
        for _, row in sub.iterrows():
            com_list = row["comname"]
            first_common = (
                com_list[0]
                if isinstance(com_list, (list, np.ndarray)) and len(com_list) > 0
                else str(row["scientificname"])
            )
            results.append(
                {
                    "scientificname": str(row["scientificname"]),
                    "common_name": first_common,
                    "family": str(row["famname"]).split(":")[-1] if ":" in str(row["famname"]) else str(row["famname"]),
                    "temp_opt": [
                        float(row["topmn"]) if pd.notna(row["topmn"]) else None,
                        float(row["topmx"]) if pd.notna(row["topmx"]) else None,
                    ],
                    "rain_opt_mm": [
                        float(row["ropmn"]) if pd.notna(row["ropmn"]) else None,
                        float(row["ropmx"]) if pd.notna(row["ropmx"]) else None,
                    ],
                    "ph_opt": [
                        float(row["phopmn"]) if pd.notna(row["phopmn"]) else None,
                        float(row["phopmx"]) if pd.notna(row["phopmx"]) else None,
                    ],
                    "cycle_days": [
                        int(row["gmin"]) if pd.notna(row["gmin"]) else None,
                        int(row["gmax"]) if pd.notna(row["gmax"]) else None,
                    ],
                }
            )
        return results

    def score_crop(self, scientific_name: str, t_mean: float, rain_mm: float, soil_ph: float = 6.5) -> dict[str, Any]:
        """Calculate FAO EcoCrop suitability scores for a specific crop."""
        query = scientific_name.strip()
        if not query:
            raise ValueError("A crop name is required")
        match = self.df[self.df["scientificname"].str.strip().str.lower() == query.lower()]
        if match.empty:
            match = self.df[self.df["scientificname"].str.contains(query, case=False, na=False, regex=False)]
        if match.empty:
            raise ValueError(f"Crop '{scientific_name}' not found in EcoCrop dataset.")
        if match["scientificname"].str.lower().nunique() != 1:
            raise ValueError(f"Ambiguous crop '{scientific_name}'; use a full scientific name")
        if rain_mm < 0 or (not pd.isna(soil_ph) and not 0 <= soil_ph <= 14):
            raise ValueError("Rainfall must be nonnegative and pH between 0 and 14")

        row = match.iloc[0]
        s_t = trapezoidal_suitability(t_mean, row["tmin"], row["topmn"], row["topmx"], row["tmax"])
        s_r = trapezoidal_suitability(rain_mm, row["rmin"], row["ropmn"], row["ropmx"], row["rmax"])
        s_ph = trapezoidal_suitability(soil_ph, row["phmin"], row["phopmn"], row["phopmx"], row["phmax"])

        warnings = []
        for dimension, value, columns in [
            ("temperature", t_mean, ["tmin", "topmn", "topmx", "tmax"]),
            ("rain", rain_mm, ["rmin", "ropmn", "ropmx", "rmax"]),
            ("pH", soil_ph, ["phmin", "phopmn", "phopmx", "phmax"]),
        ]:
            if pd.isna(value) or any(pd.isna(row[column]) for column in columns):
                warnings.append(f"Missing {dimension} input or thresholds; score uses neutral/fallback values")

        # Composite score (geometric mean)
        if s_t == 0.0 or s_r == 0.0:
            composite = 0.0
        else:
            composite = (s_t * s_r * (s_ph**0.5)) ** (1.0 / 2.5)

        com_list = row["comname"]
        first_common = (
            com_list[0]
            if isinstance(com_list, (list, np.ndarray)) and len(com_list) > 0
            else str(row["scientificname"])
        )
        family = str(row["famname"]).split(":")[-1] if ":" in str(row["famname"]) else str(row["famname"])

        return {
            "scientificname": str(row["scientificname"]),
            "common_name": first_common,
            "family": family,
            "data_state": "incomplete" if warnings else "complete",
            "warnings": warnings,
            "score_composite": round(float(composite), 1),
            "score_temperature": round(float(s_t), 1),
            "score_rain": round(float(s_r), 1),
            "score_ph": round(float(s_ph), 1),
            "cycle_days": [
                int(row["gmin"]) if pd.notna(row["gmin"]) else 90,
                int(row["gmax"]) if pd.notna(row["gmax"]) else 150,
            ],
            "water_opt_mm": [
                float(row["ropmn"]) if pd.notna(row["ropmn"]) else 500,
                float(row["ropmx"]) if pd.notna(row["ropmx"]) else 800,
            ],
            "temp_opt_c": [
                float(row["topmn"]) if pd.notna(row["topmn"]) else 18,
                float(row["topmx"]) if pd.notna(row["topmx"]) else 30,
            ],
        }


class EcoCropRiskModel:
    """Random Forest Classifier for Climatic Stress and Vulnerability.

    Synthetic surrogate of an explicit stress heuristic, not a field-trained model.
    """

    def __init__(self, engine: EcoCropEngine | None = None):
        self.engine = engine or EcoCropEngine()
        self.model = None
        self.feature_names = list(FEATURE_NAMES)
        self._train_default_model()

    def _train_default_model(self) -> None:
        """Fit frozen CV-selected settings; parameter search is an offline operation."""
        config = load_training_config()
        self.training_samples = int(config["samples"])
        self.training_metadata = {
            "data_version": config["data_version"],
            "selection": config["selection"],
            "folds": config.get("folds"),
            "seed": config["seed"],
            "params": dict(config["params"]),
        }
        try:
            from sklearn.ensemble import RandomForestClassifier
        except ImportError:
            self.model = None
            self.has_sklearn = False
            return
        data = make_risk_dataset(self.training_samples, int(config["seed"]))
        self.training_feature_bounds = np.column_stack((data.features.min(axis=0), data.features.max(axis=0)))
        clf = RandomForestClassifier(**config["params"], random_state=int(config["seed"]), n_jobs=1)
        clf.fit(data.features, data.labels)
        self.model = clf
        self.has_sklearn = True

    def predict_risk(
        self,
        t_mean: float,
        t_extreme_days: int,
        rain_mm: float,
        crop_water_need: float,
        cycle_days: int = 120,
        soil_ph: float = 6.5,
        soil_awc: float = 150.0,
        is_same_family: bool = False,
        is_legume_preceding: bool = False,
    ) -> dict[str, Any]:
        """Predict climatic risk category and return explainability weights."""
        numeric = [t_mean, t_extreme_days, rain_mm, crop_water_need, cycle_days, soil_ph, soil_awc]
        if not all(math.isfinite(float(value)) for value in numeric):
            raise ValueError("Risk inputs must be finite")
        if cycle_days <= 0 or crop_water_need <= 0 or rain_mm < 0 or soil_awc < 0:
            raise ValueError("Cycle and demand must be positive; rainfall and AWC nonnegative")
        if not 0 <= soil_ph <= 14 or not 0 <= t_extreme_days <= cycle_days:
            raise ValueError("Invalid pH or extreme-day count")
        if (
            isinstance(cycle_days, bool)
            or isinstance(t_extreme_days, bool)
            or not float(cycle_days).is_integer()
            or not float(t_extreme_days).is_integer()
        ):
            raise ValueError("Cycle and extreme-day counts must be integers")
        t_extreme_ratio = t_extreme_days / cycle_days
        rain_deficit = max(0.0, (crop_water_need - rain_mm) / crop_water_need)

        feat = np.array(
            [
                [
                    t_mean,
                    t_extreme_ratio,
                    rain_mm,
                    rain_deficit,
                    soil_ph,
                    soil_awc,
                    cycle_days,
                    crop_water_need,
                    1.0 if is_same_family else 0.0,
                    1.0 if is_legume_preceding else 0.0,
                ]
            ]
        )

        importances: dict[str, float]
        if getattr(self, "has_sklearn", False) and self.model is not None:
            probs = np.zeros(3)
            probs[self.model.classes_.astype(int)] = self.model.predict_proba(feat)[0]
            importances = dict(
                zip(self.feature_names, [round(float(w), 3) for w in self.model.feature_importances_], strict=False)
            )
        else:
            # Same heuristic and label-noise assumption as RF training.
            stress_idx = (
                rain_deficit * 0.40
                + t_extreme_ratio * 0.30
                + (1.0 - soil_awc / 220.0) * 0.15
                + float(is_same_family) * 0.15
                - float(is_legume_preceding) * 0.10
            )

            def cdf(threshold: float) -> float:
                return 0.5 * (1.0 + math.erf((threshold - stress_idx) / (0.05 * math.sqrt(2))))

            p_low, below_high = cdf(0.30), cdf(0.58)
            probs = [p_low, below_high - p_low, 1.0 - below_high]
            importances = {}  # No learned feature importances in the analytic fallback.

        outside = []
        if self.has_sklearn and hasattr(self, "training_feature_bounds"):
            for name, value, (lower, upper) in zip(
                self.feature_names, feat[0], self.training_feature_bounds, strict=True
            ):
                if not lower <= value <= upper:
                    outside.append(name)
        warnings = ["Synthetic heuristic; probabilities are not calibrated field risks."]
        if outside:
            warnings.append("Outside synthetic training ranges: " + ", ".join(outside))

        risk_score_pct = round(float(probs[2] * 100 + probs[1] * 50), 1)
        pred_class = int(np.argmax(probs))

        labels = ["BAJO", "MODERADO", "ALTO"]

        # Explainability: Top contributing factors
        factors = []
        if rain_deficit > 0.3:
            factors.append(f"Déficit hídrico del {int(rain_deficit * 100)}% frente a la demanda del cultivo")
        if t_extreme_ratio > 0.1:
            factors.append(f"{t_extreme_days} días con calor extremo superior al umbral térmico")
        if is_same_family:
            factors.append("Monocultivo consecutivo de la misma familia botánica (riesgo de plagas)")
        if is_legume_preceding:
            factors.append("Abono de nitrógeno por leguminosa previa (mitiga estrés)")
        if not factors:
            factors.append("Sin factores destacados por la heuristica; no confirma condiciones optimas")

        return {
            "model_source": "synthetic_random_forest" if self.has_sklearn else "analytic_heuristic",
            "field_validated": False,
            "warnings": warnings,
            "out_of_training_range": outside,
            "training": self.training_metadata,
            "risk_level": labels[pred_class],
            "risk_score_pct": risk_score_pct,
            "probabilities": {
                "low": float(probs[0]),
                "moderate": float(probs[1]),
                "high": float(probs[2]),
            },
            "primary_factors": factors,
            "feature_importances": importances,
        }


class RotationEngine:
    """Multi-objective crop rotation sequencer and optimizer."""

    # Key global commercial crops present in EcoCrop
    PRIMARY_CROPS: list[dict[str, Any]] = [
        {"id": "corn", "name": "Maíz", "scientific": "Zea mays", "family": "Poaceae", "is_legume": False},
        {
            "id": "bean",
            "name": "Frijol común",
            "scientific": "Phaseolus vulgaris",
            "family": "Fabaceae",
            "is_legume": True,
        },
        {"id": "soybean", "name": "Soya", "scientific": "Glycine max", "family": "Fabaceae", "is_legume": True},
        {"id": "wheat", "name": "Trigo", "scientific": "Triticum aestivum", "family": "Poaceae", "is_legume": False},
        {"id": "sorghum", "name": "Sorgo", "scientific": "Sorghum bicolor", "family": "Poaceae", "is_legume": False},
        {"id": "rice", "name": "Arroz", "scientific": "Oryza sativa", "family": "Poaceae", "is_legume": False},
        {
            "id": "sunflower",
            "name": "Girasol",
            "scientific": "Helianthus annuus",
            "family": "Asteraceae",
            "is_legume": False,
        },
        {
            "id": "chickpea",
            "name": "Garbanzo",
            "scientific": "Cicer arietinum",
            "family": "Fabaceae",
            "is_legume": True,
        },
        {
            "id": "cover_vetch",
            "name": "Vicia (cobertura)",
            "scientific": "Vicia sativa ssp. sativa",
            "family": "Fabaceae",
            "is_legume": True,
        },
    ]

    def __init__(
        self,
        ecocrop: EcoCropEngine | None = None,
        risk_model: EcoCropRiskModel | None = None,
        *,
        enable_risk: bool = True,
    ):
        self.ecocrop = ecocrop or EcoCropEngine()
        self.risk_model = risk_model or (EcoCropRiskModel(self.ecocrop) if enable_risk else None)

    def evaluate_rotation(
        self,
        sequence: list[str],
        t_mean: float,
        rain_mm: float,
        soil_ph: float = 6.5,
        soil_awc: float = 140.0,
        t_extreme_days: int = 4,
        *,
        previous_crop: str | None = None,
    ) -> dict[str, Any]:
        """Comparative EcoCrop index with explicit product bonuses, not a success probability.

        Risk is auxiliary and does not enter the ranking. EcoCrop precipitation and
        cycle water demand still require temporal-unit verification before field use.
        """
        return self._evaluate_rotation(sequence, t_mean, rain_mm, soil_ph, soil_awc, t_extreme_days, previous_crop, {})

    def _evaluate_rotation(
        self,
        sequence: list[str],
        t_mean: float,
        rain_mm: float,
        soil_ph: float,
        soil_awc: float,
        t_extreme_days: int,
        previous_crop: str | None,
        cache: dict[tuple[str, bool, bool], dict[str, Any]],
    ) -> dict[str, Any]:
        crop_map = {c["id"]: c for c in self.PRIMARY_CROPS}
        if not isinstance(sequence, (list, tuple)) or not 1 <= len(sequence) <= 4:
            raise ValueError("A rotation must contain 1 to 4 crops")
        if any(crop_id not in crop_map for crop_id in sequence):
            raise ValueError("Unknown crop in rotation sequence")
        if previous_crop is not None and previous_crop not in crop_map:
            raise ValueError("Unknown previous crop")
        cycle_details = []
        prev_crop = crop_map.get(previous_crop)
        warnings = {
            "Prototype index; planting calendars and water availability are not validated",
            "EcoCrop rainfall thresholds are not verified cycle water requirements; risk is auxiliary",
            "One climate scenario is reused for every cycle",
        }
        for cycle_idx, crop_id in enumerate(sequence):
            crop_meta = crop_map[crop_id]
            same_family = prev_crop is not None and prev_crop["family"] == crop_meta["family"]
            legume_bonus = prev_crop is not None and prev_crop["is_legume"] and not crop_meta["is_legume"]
            key = (crop_id, same_family, legume_bonus)
            if key not in cache:
                eco = self.ecocrop.score_crop(crop_meta["scientific"], t_mean, rain_mm, soil_ph)
                risk: dict[str, Any] = (
                    self.risk_model.predict_risk(
                        t_mean=t_mean,
                        t_extreme_days=t_extreme_days,
                        rain_mm=rain_mm,
                        crop_water_need=eco["water_opt_mm"][0],
                        cycle_days=eco["cycle_days"][1],
                        soil_ph=soil_ph,
                        soil_awc=soil_awc,
                        is_same_family=same_family,
                        is_legume_preceding=legume_bonus,
                    )
                    if self.risk_model is not None
                    else {"risk_level": None, "primary_factors": [None]}
                )
                suitability = eco["score_composite"]
                adjustment = (-15.0 if same_family else 0.0) + (10.0 if legume_bonus else 0.0)
                score = max(0.0, min(100.0, suitability + adjustment)) if suitability > 0 else 0.0
                cache[key] = {
                    "crop_id": crop_id,
                    "name": crop_meta["name"],
                    "scientific": crop_meta["scientific"],
                    "family": crop_meta["family"],
                    "score": round(score, 1),
                    "ecocrop_suitability": suitability,
                    "temperature_fit": eco["score_temperature"],
                    "rainfall_fit": eco["score_rain"],
                    "ph_fit": eco["score_ph"],
                    "dimension_warnings": list(eco["warnings"]),
                    "risk_level": risk["risk_level"],
                    "key_risk_factor": risk["primary_factors"][0],
                    "same_family": same_family,
                    "legume_preceding": legume_bonus,
                    "data_state": eco["data_state"],
                    "warnings": list(eco["warnings"]),
                }
            detail = cache[key]
            warnings.update(detail["warnings"])
            cycle_details.append({**detail, "warnings": list(detail["warnings"]), "cycle": cycle_idx + 1})
            prev_crop = crop_meta
        overall = round(float(np.mean([c["score"] for c in cycle_details])), 1)
        return {
            "sequence": list(sequence),
            "overall_score": overall,
            "cycles": cycle_details,
            "status": "\u00d3PTIMA" if overall >= 75 else ("VIABLE" if overall >= 50 else "RIESGOSA"),
            "score_type": "comparative_index",
            "field_validated": False,
            "warnings": sorted(warnings),
        }

    def recommend_top_rotations(
        self,
        t_mean: float,
        rain_mm: float,
        soil_ph: float = 6.5,
        soil_awc: float = 140.0,
        t_extreme_days: int = 4,
        cycles: int = 3,
        top_k: int = 3,
        *,
        previous_crop: str | None = None,
        exclude_same_family: bool = False,
    ) -> list[dict[str, Any]]:
        """Enumerate 2-4 cycle candidates with optional family exclusion and history.

        A request-local cache evaluates each crop/transition only once, so all
        candidates share consistent results without repeated RF inference.
        """
        from .rotation import generate_candidates

        if type(top_k) is not int or top_k < 1:
            raise ValueError("top_k must be a positive integer")
        candidate_ids = {"corn", "bean", "soybean", "wheat", "sorghum", "chickpea", "cover_vetch"}
        # Include a known previous crop for history even if it is outside the candidate pool.
        families = {c["id"]: c["family"] for c in self.PRIMARY_CROPS if c["id"] in candidate_ids}
        crop_map = {c["id"]: c for c in self.PRIMARY_CROPS}
        if previous_crop is not None and previous_crop not in crop_map:
            raise ValueError("Unknown previous crop")
        if previous_crop is not None and previous_crop not in families:
            families[previous_crop] = crop_map[previous_crop]["family"]
        sequences = generate_candidates(families, cycles, previous_crop, exclude_same_family)
        cache: dict[tuple[str, bool, bool], dict[str, Any]] = {}
        results = [
            self._evaluate_rotation(seq, t_mean, rain_mm, soil_ph, soil_awc, t_extreme_days, previous_crop, cache)
            for seq in sequences
            if all(crop_id in candidate_ids for crop_id in seq)
        ]
        results.sort(key=lambda item: (-item["overall_score"], tuple(item["sequence"])))
        return results[:top_k]
