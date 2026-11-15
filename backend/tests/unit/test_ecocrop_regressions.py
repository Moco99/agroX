"""EcoCrop and rotation regression checks; no external services required."""

import numpy as np
import pytest

from app.engine.ecocrop_model import EcoCropRiskModel, RotationEngine, trapezoidal_suitability
from app.engine.rotation import generate_candidates, rank_rotations


@pytest.fixture(scope="module")
def model():
    return EcoCropRiskModel()


def test_public_label_matches_most_likely_class(model):
    result = model.predict_risk(24, 50, 200, 650, 120, is_same_family=True)
    names = ["BAJO", "MODERADO", "ALTO"]
    assert result["risk_level"] == names[int(np.argmax(list(result["probabilities"].values())))]
    assert abs(sum(result["probabilities"].values()) - 1) <= 0.002
    assert result["field_validated"] is False


@pytest.mark.parametrize(
    "override",
    [
        {"rain_mm": -1},
        {"cycle_days": 0},
        {"crop_water_need": 0},
        {"t_extreme_days": 121},
        {"soil_ph": 15},
        {"soil_awc": -1},
        {"t_mean": float("nan")},
    ],
)
def test_reject_invalid_inputs(model, override):
    kwargs = dict(t_mean=24, t_extreme_days=3, rain_mm=500, crop_water_need=650)
    kwargs.update(override)
    with pytest.raises(ValueError):
        model.predict_risk(**kwargs)


def test_analytic_fallback_and_severity(model, monkeypatch):
    monkeypatch.setattr(model, "has_sklearn", False)
    low = model.predict_risk(24, 0, 800, 650, soil_awc=220)
    high = model.predict_risk(24, 120, 0, 650, soil_awc=80, is_same_family=True)
    assert low["risk_level"] == "BAJO"
    assert high["risk_level"] == "ALTO"
    assert high["risk_score_pct"] > low["risk_score_pct"]
    assert high["model_source"] == "analytic_heuristic"
    assert high["feature_importances"] == {}


def test_candidates_use_history_and_requested_length():
    families = {"corn": "Poaceae", "bean": "Fabaceae"}
    assert len(generate_candidates(families, cycles=4)) == 16
    assert generate_candidates(families, cycles=3, previous_crop="corn", exclude_same_family=True) == [
        ["bean", "corn", "bean"]
    ]


def test_ranking_changes_with_priorities():
    items = [
        {"sequence": ["corn", "bean"], "indicators": {"water": 90, "soil": 20, "climate": 60}},
        {"sequence": ["bean", "corn"], "indicators": {"water": 20, "soil": 90, "climate": 60}},
    ]
    water = rank_rotations(items, {"water": 8, "soil": 1, "climate": 1})
    soil = rank_rotations(items, {"water": 1, "soil": 8, "climate": 1})
    assert water[0]["sequence"] != soil[0]["sequence"]
    assert abs(sum(water[0]["weights"].values()) - 1) < 1e-12
    with pytest.raises(ValueError):
        rank_rotations(items, {"water": 0, "soil": 0, "climate": 0})


@pytest.fixture(scope="module")
def rotation(model):
    return RotationEngine(model.engine, model)


@pytest.mark.parametrize("sequence", [[], ["corn", "missing"], ["corn"] * 5])
def test_rotation_rejects_invalid_sequences(rotation, sequence):
    with pytest.raises(ValueError):
        rotation.evaluate_rotation(sequence, 24, 700)


@pytest.mark.parametrize("name", ["", "   ", "Zea"])
def test_scoring_rejects_empty_or_ambiguous_species(model, name):
    with pytest.raises(ValueError):
        model.engine.score_crop(name, 24, 700)


@pytest.mark.parametrize("override", [{"t_extreme_days": 1.5}, {"cycle_days": 120.5}])
def test_days_must_be_integers(model, override):
    kwargs = dict(t_mean=24, t_extreme_days=3, rain_mm=500, crop_water_need=650)
    kwargs.update(override)
    with pytest.raises(ValueError):
        model.predict_risk(**kwargs)


def test_weight_scale_invariance_at_extremes():
    items = [{"sequence": ["corn", "bean"], "indicators": {"water": 100, "soil": 100, "climate": 100}}]
    for weight in [1, 1e308, 1e-308]:
        result = rank_rotations(items, {"water": weight, "soil": weight, "climate": weight})[0]
        assert result["score"] == pytest.approx(100)
        assert sum(result["weights"].values()) == pytest.approx(1)


def test_four_cycle_recommendations_and_history(rotation):
    results = rotation.recommend_top_rotations(
        24, 700, cycles=4, top_k=5, previous_crop="corn", exclude_same_family=True
    )
    assert len(results) == 5
    families = {c["id"]: c["family"] for c in rotation.PRIMARY_CROPS}
    for result in results:
        assert len(result["cycles"]) == 4
        history = ["corn"] + result["sequence"]
        assert all(families[a] != families[b] for a, b in zip(history, history[1:], strict=False))
    assert len({tuple(r["sequence"]) for r in results}) == 5
    assert [r["overall_score"] for r in results] == sorted([r["overall_score"] for r in results], reverse=True)


@pytest.mark.parametrize("kwargs", [{"cycles": 0}, {"cycles": 5}, {"top_k": 0}, {"top_k": True}])
def test_recommendation_rejects_invalid_sizes(rotation, kwargs):
    with pytest.raises(ValueError):
        rotation.recommend_top_rotations(24, 700, **kwargs)


def test_rotation_bonus_cannot_revive_incompatible_crop(rotation):
    result = rotation.evaluate_rotation(["bean", "corn"], -50, 700)
    assert result["overall_score"] == 0
    assert all(c["score"] == 0 for c in result["cycles"])


@pytest.mark.parametrize("values", [(20, 40, 20, 30, 10), (20, 10, 35, 25, 40), (float("inf"), 10, 20, 30, 40)])
def test_invalid_membership_thresholds(values):
    with pytest.raises(ValueError):
        trapezoidal_suitability(*values)


def test_unknown_suitability_is_explicit(model):
    result = model.engine.score_crop("Zea mays", float("nan"), 700)
    assert result["data_state"] == "incomplete"
    assert result["warnings"]


def test_risk_fallback_tiny_demand_uses_true_deficit(model, monkeypatch):
    monkeypatch.setattr(model, "has_sklearn", False)
    tiny = model.predict_risk(24, 30, 0.125, 0.5)
    scaled = model.predict_risk(24, 30, 125, 500)
    assert tiny["probabilities"] == scaled["probabilities"]


def test_probability_precision_preserves_predicted_class(model, monkeypatch):
    from unittest.mock import Mock

    stub = Mock()
    stub.classes_ = np.array([0, 1, 2])
    stub.predict_proba.return_value = np.array([[0.4996, 0.5004, 0]])
    stub.feature_importances_ = np.ones(10) / 10
    monkeypatch.setattr(model, "model", stub)
    result = model.predict_risk(24, 3, 500, 650)
    assert result["risk_level"] == "MODERADO"
    assert result["probabilities"]["moderate"] > result["probabilities"]["low"]


def test_request_cache_reduces_inference_without_cross_climate_leak(rotation, monkeypatch):
    from unittest.mock import Mock

    predict = Mock(wraps=rotation.risk_model.predict_risk)
    monkeypatch.setattr(rotation.risk_model, "predict_risk", predict)
    normal = rotation.recommend_top_rotations(24, 700, cycles=4)
    # Each of 7 species has at most 3 predecessor states, independent of 7**4 sequences.
    assert predict.call_count <= 21
    predict.reset_mock()
    cold = rotation.recommend_top_rotations(-50, 700, cycles=4)
    assert predict.call_count > 0
    assert normal[0]["overall_score"] > cold[0]["overall_score"]
    assert cold[0]["overall_score"] == 0


def test_suitability_known_boundaries_and_monotonicity():
    left = [trapezoidal_suitability(v, 10, 20, 30, 40) for v in range(10, 21)]
    right = [trapezoidal_suitability(v, 10, 20, 30, 40) for v in range(30, 41)]
    assert left == sorted(left)
    assert right == sorted(right, reverse=True)
    assert trapezoidal_suitability(20, 10, 20, 30, 40) == 100
    assert trapezoidal_suitability(10, 10, 10, 30, 40) == 100
