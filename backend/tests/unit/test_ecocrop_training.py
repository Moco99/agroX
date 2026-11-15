"""Dataset, CV isolation and runtime training configuration checks."""

import numpy as np
import pytest
from sklearn.model_selection import StratifiedGroupKFold

from app.engine.ecocrop_model import EcoCropRiskModel
from app.engine.risk_training import FEATURE_NAMES, load_training_config, make_risk_dataset
from scripts.tune_ecocrop import select_candidate


def test_dataset_is_reproducible_and_physically_consistent():
    a = make_risk_dataset(1000, seed=123)
    b = make_risk_dataset(1000, seed=123)
    assert np.array_equal(a.features, b.features)
    assert np.array_equal(a.labels, b.labels)
    rain, deficit, cycle, need = (a.features[:, i] for i in [2, 3, 6, 7])
    assert np.allclose(deficit, np.maximum(0, (need - rain) / need))
    assert np.allclose(a.features[:, 1] * cycle, np.rint(a.features[:, 1] * cycle))
    assert a.features.shape == (1000, len(FEATURE_NAMES))
    assert set(a.labels) == {0, 1, 2}


def test_grouped_folds_do_not_share_crop_profiles():
    data = make_risk_dataset(3000)
    splits = StratifiedGroupKFold(5, shuffle=True, random_state=20261118).split(data.features, data.labels, data.groups)
    validation = []
    for train, valid in splits:
        assert set(data.groups[train]).isdisjoint(set(data.groups[valid]))
        validation.extend(valid.tolist())
    assert sorted(validation) == list(range(3000))


@pytest.mark.parametrize("profile", ["unseen_profiles", "shifted_drought", "shifted_wet"])
def test_final_novel_profiles_have_no_development_groups(profile):
    train = make_risk_dataset(1000)
    test = make_risk_dataset(1000, seed=800, profile=profile)
    assert set(train.groups).isdisjoint(set(test.groups))
    assert np.all(np.isfinite(test.features))


def test_selection_prefers_simpler_candidate_without_sacrificing_class_recall():
    results = {
        "mean_test_f1_macro": np.array([0.803, 0.81, 0.809]),
        "std_test_f1_macro": np.array([0.02, 0.02, 0.02]),
        "mean_test_balanced_accuracy": np.array([0.80, 0.81, 0.81]),
        "mean_test_high_recall": np.array([0.80, 0.82, 0.40]),
        "mean_test_neg_log_loss": np.array([-0.40, -0.395, -0.39]),
        "params": [
            {"n_estimators": 60, "max_depth": 10, "min_samples_leaf": 4},
            {"n_estimators": 240, "max_depth": 20, "min_samples_leaf": 2},
            {"n_estimators": 10, "max_depth": 4, "min_samples_leaf": 20},
        ],
    }
    assert select_candidate(results) == 0


def test_runtime_uses_frozen_config_and_warns_on_extrapolation():
    config = load_training_config()
    model = EcoCropRiskModel()
    assert model.model.get_params()["n_estimators"] == config["params"]["n_estimators"]
    assert model.training_metadata["selection"] == config["selection"]
    result = model.predict_risk(42, 100, 50, 650, soil_awc=40)
    assert "t_mean" in result["out_of_training_range"]
    assert "soil_awc" in result["out_of_training_range"]
    assert result["field_validated"] is False
