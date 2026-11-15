"""Grouped CV and a single final evaluation of synthetic risk generalization.

Run from repository root: .venv/Scripts/python backend/scripts/tune_ecocrop.py --apply
No holdout metric participates in selecting parameters or deciding what to apply.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sqlite3
import sys
from pathlib import Path
from time import perf_counter

import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    make_scorer,
    recall_score,
)
from sklearn.model_selection import GridSearchCV, ParameterSampler, StratifiedGroupKFold

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.engine.risk_training import (  # noqa: E402
    BASELINE_PARAMS,
    CONFIG_PATH,
    DATA_VERSION,
    FEATURE_NAMES,
    make_risk_dataset,
)

FOLDS = 5
SEARCH_SEED = 20261118
HOLDOUTS = {"iid": 20261201, "unseen_profiles": 20261202, "shifted_drought": 20261203, "shifted_wet": 20261204}


def select_candidate(results):
    """One-SE rule, per-class guardrails and probability-loss constraint, then simplicity."""
    mean = np.asarray(results["mean_test_f1_macro"])
    best = int(np.argmax(mean))
    threshold = mean[best] - results["std_test_f1_macro"][best] / np.sqrt(FOLDS)
    eligible = np.flatnonzero(
        (mean >= threshold)
        & (results["mean_test_balanced_accuracy"] >= results["mean_test_balanced_accuracy"][0] - 0.005)
        & (results["mean_test_high_recall"] >= results["mean_test_high_recall"][0] - 0.01)
    )
    if not len(eligible):
        eligible = np.array([0])  # Baseline remains valid when guardrails reject the best mean.
    best_loss = max(results["mean_test_neg_log_loss"][i] for i in eligible)
    eligible = [i for i in eligible if results["mean_test_neg_log_loss"][i] >= best_loss - 0.01]

    def complexity(i):
        p = results["params"][i]
        return (p["n_estimators"] * (p["max_depth"] or 32), -p["min_samples_leaf"], -mean[i])

    return int(min(eligible, key=complexity))


def evaluate(model, data):
    probabilities = model.predict_proba(data.features)
    predicted = model.classes_[probabilities.argmax(axis=1)]

    def metrics(labels):
        return {
            "accuracy": accuracy_score(labels, predicted),
            "balanced_accuracy": balanced_accuracy_score(labels, predicted),
            "f1_macro": f1_score(labels, predicted, average="macro", zero_division=0),
            "log_loss": log_loss(labels, probabilities, labels=[0, 1, 2]),
            "confusion_matrix": confusion_matrix(labels, predicted, labels=[0, 1, 2]).tolist(),
            "classes": classification_report(
                labels,
                predicted,
                labels=[0, 1, 2],
                target_names=["BAJO", "MODERADO", "ALTO"],
                output_dict=True,
                zero_division=0,
            ),
        }

    model.predict_proba(data.features[:128])  # Warm-up is excluded from timings.
    batch_ms, single_ms = [], []
    for _ in range(5):
        start = perf_counter()
        model.predict_proba(data.features)
        batch_ms.append((perf_counter() - start) * 1000)
        start = perf_counter()
        for row in data.features[:30]:
            model.predict_proba(row.reshape(1, -1))
        single_ms.append((perf_counter() - start) * 1000 / 30)
    summary = {
        "samples": len(data.labels),
        "observed_synthetic_labels": metrics(data.labels),
        "noiseless_oracle": metrics(data.oracle_labels),
        "inference_batch_median_ms": float(np.median(batch_ms)),
        "inference_single_median_ms": float(np.median(single_ms)),
        "tree_nodes": sum(tree.tree_.node_count for tree in model.estimators_),
    }
    return summary, probabilities, predicted


def paired_accuracy_interval(labels, baseline, selected, seed=20261119):
    """Paired bootstrap CI; uncertainty is conditional on this synthetic generator."""
    difference = (selected == labels).astype(float) - (baseline == labels).astype(float)
    rng = np.random.default_rng(seed)
    samples = []
    for _ in range(20):
        indices = rng.integers(0, len(difference), size=(100, len(difference)))
        samples.extend(difference[indices].mean(axis=1).tolist())
    lower, upper = np.quantile(samples, [0.025, 0.975])
    return {
        "delta": float(difference.mean()),
        "lower_95": float(lower),
        "upper_95": float(upper),
        "bootstrap_resamples": 2000,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", type=int, default=20)
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "backend/validation/cross_validation")
    args = parser.parse_args()
    if args.candidates < 1 or args.jobs < 1:
        parser.error("candidates and jobs must be positive")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    development = make_risk_dataset()
    cv = StratifiedGroupKFold(n_splits=FOLDS, shuffle=True, random_state=SEARCH_SEED)
    splits = list(cv.split(development.features, development.labels, development.groups))
    audit = []
    for train, valid in splits:
        train_groups, valid_groups = set(development.groups[train]), set(development.groups[valid])
        assert train_groups.isdisjoint(valid_groups)
        audit.append(
            {
                "train_rows": len(train),
                "validation_rows": len(valid),
                "train_groups": sorted(train_groups),
                "validation_groups": sorted(valid_groups),
                "group_overlap": 0,
            }
        )
    space = {
        "n_estimators": [60, 100, 160, 240],
        "max_depth": [6, 10, 14, 20, None],
        "min_samples_leaf": [2, 4, 8, 16],
        "max_features": ["sqrt", 0.7, 1.0],
        "class_weight": [None, "balanced_subsample"],
        "max_samples": [0.7, 1.0],
    }
    candidates = [BASELINE_PARAMS.copy()] + list(
        ParameterSampler(space, n_iter=args.candidates, random_state=SEARCH_SEED)
    )
    grid = [{key: [value] for key, value in candidate.items()} for candidate in candidates]
    scoring = {
        "accuracy": "accuracy",
        "balanced_accuracy": "balanced_accuracy",
        "f1_macro": "f1_macro",
        "neg_log_loss": "neg_log_loss",
        "high_recall": make_scorer(recall_score, labels=[2], average="macro", zero_division=0),
    }
    model = RandomForestClassifier(random_state=42, n_jobs=1)
    search = GridSearchCV(
        model,
        grid,
        scoring=scoring,
        refit=select_candidate,
        cv=splits,
        n_jobs=args.jobs,
        pre_dispatch=args.jobs,
        return_train_score=True,
        error_score="raise",
        verbose=2,
    )
    print(f"CV: {len(candidates)} candidates x {FOLDS} grouped folds; holdouts unopened", flush=True)
    start = perf_counter()
    search.fit(development.features, development.labels)
    cv_seconds = perf_counter() - start
    results = search.cv_results_
    candidate_rows = []
    for i, params in enumerate(results["params"]):
        row = {"candidate": i, "params": params, "selected": i == search.best_index_}
        for key, value in results.items():
            if key.startswith(("mean_", "std_", "split")) and key not in {"params"}:
                row[key] = float(value[i])
        candidate_rows.append(row)
    (args.output_dir / "cv_candidates.json").write_text(json.dumps(candidate_rows, indent=2), encoding="utf-8")
    config = {
        "data_version": DATA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "samples": 12000,
        "seed": 42,
        "params": search.best_params_,
        "selection": "grouped_cv_one_standard_error",
        "search_seed": SEARCH_SEED,
        "folds": FOLDS,
        "candidate_count": len(candidates),
    }
    # Freeze selection BEFORE constructing or looking at any final holdout.
    (args.output_dir / "selected_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    if args.apply:
        CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"CV selected candidate {search.best_index_}: {search.best_params_}", flush=True)
    baseline = RandomForestClassifier(**BASELINE_PARAMS, random_state=42, n_jobs=1)
    baseline.fit(development.features, development.labels)
    report = {
        "data_type": "synthetic heuristic with Gaussian label noise sigma=0.05; not field outcomes",
        "versions": {"python": platform.python_version(), "numpy": np.__version__, "sklearn": sklearn.__version__},
        "protocol": (
            "5-fold stratified grouped CV on 30 cycle/demand profiles; independent final tests after frozen selection"
        ),
        "selection_rule": (
            "Within one SE of best macro F1, baseline recall/balanced-accuracy guardrails, "
            "log-loss tolerance .01, then smaller forest"
        ),
        "cv_fit_seconds": cv_seconds,
        "cv_candidates": len(candidates),
        "cv_fits": len(candidates) * FOLDS,
        "fold_audit": audit,
        "selected_config": config,
        "selected_candidate": search.best_index_,
        "baseline_cv": candidate_rows[0],
        "selected_cv": candidate_rows[search.best_index_],
        "holdouts": {},
        "applied": args.apply,
        "limitations": [
            "Same synthetic causal rule is used across all profiles; no field validation.",
            "Synthetic profile groups are not geographic or temporal groups.",
            "Temperature and pH are not causal in this stress heuristic; EcoCrop handles suitability separately.",
            "Extreme wetness/waterlogging is not modeled by the oracle; shifted_wet is only a feature-range test.",
            "Holdout metrics must not be reused to choose later parameters; regenerate future holdouts.",
        ],
    }
    with sqlite3.connect(args.output_dir / "holdouts.sqlite") as conn:
        conn.execute("DROP TABLE IF EXISTS predictions")
        conn.execute(
            "CREATE TABLE predictions (profile TEXT, row_id INTEGER, features_json TEXT, "
            "noisy_label INTEGER, oracle_label INTEGER, baseline_class INTEGER, selected_class INTEGER, "
            "baseline_probs TEXT, selected_probs TEXT, PRIMARY KEY(profile,row_id))"
        )
        for profile, seed in HOLDOUTS.items():
            data = make_risk_dataset(3000, seed, profile)
            if profile != "iid":
                assert set(data.groups).isdisjoint(set(development.groups))
            old, old_probs, old_classes = evaluate(baseline, data)
            new, new_probs, new_classes = evaluate(search.best_estimator_, data)
            report["holdouts"][profile] = {
                "seed": seed,
                "baseline": old,
                "selected": new,
                "paired_accuracy_delta": {
                    "observed_synthetic_labels": paired_accuracy_interval(data.labels, old_classes, new_classes),
                    "noiseless_oracle": paired_accuracy_interval(data.oracle_labels, old_classes, new_classes),
                },
            }
            rows = [
                (
                    profile,
                    i,
                    json.dumps(data.features[i].tolist()),
                    int(data.labels[i]),
                    int(data.oracle_labels[i]),
                    int(old_classes[i]),
                    int(new_classes[i]),
                    json.dumps(old_probs[i].tolist()),
                    json.dumps(new_probs[i].tolist()),
                )
                for i in range(len(data.labels))
            ]
            conn.executemany("INSERT INTO predictions VALUES (?,?,?,?,?,?,?,?,?)", rows)
            print(
                f"{profile}: noisy accuracy "
                f"{old['observed_synthetic_labels']['accuracy']:.4f} -> "
                f"{new['observed_synthetic_labels']['accuracy']:.4f}; oracle "
                f"{old['noiseless_oracle']['accuracy']:.4f} -> {new['noiseless_oracle']['accuracy']:.4f}",
                flush=True,
            )
    paths = [Path(__file__), ROOT / "backend/app/engine/risk_training.py"]
    report["source_sha256"] = {
        str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths
    }
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Report: {args.output_dir / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
