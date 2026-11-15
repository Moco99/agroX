"""Reproducible synthetic validation; NOT a field-accuracy assessment.

Run from repo root: .venv/Scripts/python backend/tests/validate_ecocrop.py
"""

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.app.engine.ecocrop_model import EcoCropEngine, EcoCropRiskModel, trapezoidal_suitability  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "backend" / "validation")
    args = parser.parse_args()
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    engine = EcoCropEngine()
    model = EcoCropRiskModel(engine)
    if not model.has_sklearn:
        raise RuntimeError("Install scikit-learn: validation requires the actual RF")
    rng = np.random.default_rng(args.seed)
    rows, expected, actual = [], [], []
    labels = ["BAJO", "MODERADO", "ALTO"]
    # Independent seed; inputs tied to water demand and integer cycle lengths.
    # Broad stress coverage is intentional, not a prevalence estimate.
    for index in range(3000):
        cycle = int(rng.choice([75, 90, 110, 130, 150, 180]))
        need = float(rng.choice([350, 500, 650, 800, 1100]))
        rain = float(need * rng.uniform(0, 1.6))
        hot = int(rng.integers(0, cycle + 1))
        awc = float(rng.uniform(80, 220))
        same, legume = bool(rng.integers(2)), bool(rng.integers(2))
        temp, ph = float(rng.uniform(8, 34)), float(rng.uniform(5, 8.2))
        deficit = max(0, (need - rain) / need)
        # Explicit noiseless oracle from the documented training heuristic.
        stress = 0.40 * deficit + 0.30 * hot / cycle + 0.15 * (1 - awc / 220) + 0.15 * same - 0.10 * legume
        target = 0 if stress < 0.30 else (1 if stress < 0.58 else 2)
        result = model.predict_risk(temp, hot, rain, need, cycle, ph, awc, same, legume)
        predicted = labels.index(result["risk_level"])
        expected.append(target)
        actual.append(predicted)
        rows.append(
            (
                index,
                temp,
                hot,
                rain,
                need,
                cycle,
                ph,
                awc,
                int(same),
                int(legume),
                deficit,
                stress,
                target,
                predicted,
                json.dumps(result),
            )
        )
    db_path = output / "ecocrop_validation.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.execute("DROP TABLE IF EXISTS risk_cases")
        conn.execute(
            (
                'CREATE TABLE risk_cases (id INTEGER PRIMARY KEY, t_mean REAL, t_extreme_days INTEGER, '
                'rain_mm REAL, crop_water_need REAL, cycle_days INTEGER, '
                'soil_ph REAL, soil_awc REAL, is_same_family INTEGER, '
                'is_legume_preceding INTEGER, rain_deficit REAL, oracle_stress REAL, '
                'expected_class INTEGER, predicted_class INTEGER, prediction_json TEXT'
            ),
        )
        conn.executemany("INSERT INTO risk_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    # Independent known-answer checks for membership geometry.
    cases = [(25, 100), (5, 0), (45, 0), (15, 50), (35, 50), (10, 0), (40, 0)]
    membership = all(trapezoidal_suitability(v, 10, 20, 30, 40) == score for v, score in cases)
    accuracy = accuracy_score(expected, actual)
    balanced = balanced_accuracy_score(expected, actual)
    metrics = classification_report(
        expected, actual, labels=[0, 1, 2], target_names=labels, output_dict=True, zero_division=0
    )
    gate = bool(membership and accuracy >= 0.85 and balanced >= 0.80 and metrics["ALTO"]["recall"] >= 0.80)
    report = {
        "seed": args.seed,
        "samples": len(rows),
        "training_samples": model.training_samples,
        "validation_type": "synthetic consistency with noiseless training heuristic; no field labels",
        "accuracy": accuracy,
        "balanced_accuracy": balanced,
        "majority_baseline": max(expected.count(c) for c in range(3)) / len(expected),
        "confusion_matrix_labels": labels,
        "confusion_matrix": confusion_matrix(expected, actual, labels=[0, 1, 2]).tolist(),
        "classification_report": metrics,
        "membership_known_answers_pass": membership,
        "prototype_gate": {
            "accuracy_min": 0.85,
            "balanced_accuracy_min": 0.80,
            "high_recall_min": 0.80,
            "passed": gate,
        },
        "source_sha256": hashlib.sha256((ROOT / "backend/app/engine/ecocrop_model.py").read_bytes()).hexdigest(),
        "limitations": [
            "Labels reproduce a heuristic, not measured damage or yield.",
            "Rainfall thresholds require temporal-unit verification before rotation use.",
            "Validation cases were used to diagnose the previous version; "
            "this is a regression benchmark, not a fresh holdout.",
            "Probabilities are uncalibrated synthetic class frequencies.",
        ],
    }
    (output / "ecocrop_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
