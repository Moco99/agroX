"""Unit tests for EcoCrop-RF Engine and Rotation Optimizer."""

from __future__ import annotations

import pytest

from app.engine.ecocrop_model import EcoCropEngine, EcoCropRiskModel, RotationEngine, trapezoidal_suitability


def test_trapezoidal_suitability():
    # Value inside optimal bounds
    assert trapezoidal_suitability(25.0, 10.0, 20.0, 30.0, 40.0) == 100.0
    # Value outside absolute bounds
    assert trapezoidal_suitability(5.0, 10.0, 20.0, 30.0, 40.0) == 0.0
    assert trapezoidal_suitability(45.0, 10.0, 20.0, 30.0, 40.0) == 0.0
    # Interpolated value between min and opt_min
    score = trapezoidal_suitability(15.0, 10.0, 20.0, 30.0, 40.0)
    assert 49.0 < score < 51.0


# ecocrop.parquet needs a parquet engine that is not a backend dependency yet (tech debt, see progress notes)
needs_parquet = pytest.mark.skipif(
    __import__("importlib").util.find_spec("pyarrow") is None, reason="pyarrow not installed"
)


@needs_parquet
def test_ecocrop_engine_query():
    engine = EcoCropEngine()
    assert len(engine.df) >= 2000

    results = engine.find_crops("Zea mays", limit=5)
    assert len(results) >= 1
    assert "Zea mays" in results[0]["scientificname"]

    maize_score = engine.score_crop("Zea mays", t_mean=24.0, rain_mm=750.0, soil_ph=6.5)
    assert maize_score["score_composite"] > 80.0
    assert maize_score["score_temperature"] == 100.0


@needs_parquet
def test_ecocrop_risk_model():
    risk_model = EcoCropRiskModel()
    # Favorable conditions
    res_low = risk_model.predict_risk(t_mean=22.0, t_extreme_days=1, rain_mm=700.0, crop_water_need=600.0)
    assert res_low["risk_level"] in ["BAJO", "MODERADO"]
    assert "probabilities" in res_low

    # Severe drought & sustained heat, away from the heuristic class boundary.
    # The old 25-day case has stress ~0.585, almost exactly the 0.58 threshold.
    res_high = risk_model.predict_risk(t_mean=36.0, t_extreme_days=80, rain_mm=150.0, crop_water_need=800.0, is_same_family=True)
    assert res_high["risk_level"] == "ALTO"
    assert len(res_high["primary_factors"]) >= 1


@needs_parquet
def test_rotation_recommendations():
    recommender = RotationEngine()
    recs = recommender.recommend_top_rotations(t_mean=22.0, rain_mm=650.0, soil_ph=6.5, cycles=3, top_k=3)
    assert len(recs) == 3
    # Top rotation must have higher score than monoculture
    top_score = recs[0]["overall_score"]
    assert top_score >= 60.0
    assert len(recs[0]["cycles"]) == 3
