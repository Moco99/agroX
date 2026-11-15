"""Run pytest with --confcutdir=backend/validation to isolate engine checks."""
import numpy as np
import pytest
from backend.app.engine.ecocrop_model import EcoCropRiskModel


@pytest.fixture(scope="module")
def model():
    return EcoCropRiskModel()


def test_public_label_matches_most_likely_class(model):
    result = model.predict_risk(24, 50, 200, 650, 120, is_same_family=True)
    names = ["BAJO", "MODERADO", "ALTO"]
    assert result["risk_level"] == names[int(np.argmax(list(result["probabilities"].values()))) ]
    assert abs(sum(result["probabilities"].values()) - 1) <= .002
    assert result["field_validated"] is False


@pytest.mark.parametrize("override", [
    {"rain_mm": -1}, {"cycle_days": 0}, {"crop_water_need": 0},
    {"t_extreme_days": 121}, {"soil_ph": 15}, {"soil_awc": -1}, {"t_mean": float("nan")},
])
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


from backend.app.engine.rotation import generate_candidates, rank_rotations


def test_candidates_use_history_and_requested_length():
    families = {"corn": "Poaceae", "bean": "Fabaceae"}
    assert len(generate_candidates(families, cycles=4)) == 16
    assert generate_candidates(families, cycles=3, previous_crop="corn", exclude_same_family=True) == [["bean", "corn", "bean"]]


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
