"""Pure rotation criteria, diverse selection and the monthly-limiting EcoCrop season."""

import pandas as pd
import pytest

from app.engine.ecocrop_model import season_fit
from app.engine.rotation import generate_candidates, rank_rotations, rotation_quality, select_diverse

FAMILIES = {"corn": "Poaceae", "wheat": "Poaceae", "soybean": "Fabaceae", "sunflower": "Asteraceae"}
LEGUMES = {"soybean"}


def test_monoculture_scores_zero_and_alternation_scores_higher() -> None:
    mono = rotation_quality(["corn", "corn", "corn"], FAMILIES, LEGUMES)
    alternate = rotation_quality(["corn", "soybean", "corn"], FAMILIES, LEGUMES)
    same_family = rotation_quality(["corn", "wheat", "corn"], FAMILIES, LEGUMES)
    assert mono["index"] == 0
    assert alternate["components"] == {
        "family_break": 100.0,
        "legume_before_non_legume": 50.0,
        "family_diversity": 50.0,
    }
    assert alternate["index"] == pytest.approx(75.0)
    # Same family is penalized less than the same crop, more than a family change
    assert mono["index"] < same_family["index"] < alternate["index"]
    assert same_family["counts"]["same_family"] == 2


def test_previous_crop_counts_as_a_transition() -> None:
    plain = rotation_quality(["soybean", "corn"], FAMILIES, LEGUMES)
    after_soy = rotation_quality(["soybean", "corn"], FAMILIES, LEGUMES, previous_crop="soybean")
    assert after_soy["counts"]["transitions"] == 2
    assert after_soy["counts"]["same_crop"] == 1
    assert after_soy["index"] < plain["index"]


def test_exclude_same_crop_also_checks_previous_crop() -> None:
    candidates = generate_candidates(FAMILIES, 2, previous_crop="corn", exclude_same_crop=True)
    assert candidates and all(seq[0] != "corn" and seq[0] != seq[1] for seq in candidates)
    assert ["wheat", "corn"] in candidates


def test_select_diverse_prefers_new_crop_sets_then_fills() -> None:
    ranked = [{"sequence": s} for s in (["a", "b", "a"], ["b", "a", "b"], ["a", "c", "a"], ["c", "a", "c"])]
    assert [r["sequence"] for r in select_diverse(ranked, 2)] == [["a", "b", "a"], ["a", "c", "a"]]
    assert [r["sequence"] for r in select_diverse(ranked, 3)] == [["a", "b", "a"], ["b", "a", "b"], ["a", "c", "a"]]


def test_rotation_weight_blends_and_is_validated() -> None:
    item = {
        "sequence": ["corn", "soybean"],
        "indicators": {"water": 80.0, "soil": 0.0, "climate": 60.0},
        "rotation": {"index": 100.0},
    }
    weights = {"water": 1.0, "soil": 0.0, "climate": 1.0}
    ranked = rank_rotations([item], weights, 0.25)[0]
    assert ranked["agroclimatic_score"] == pytest.approx(70.0)
    assert ranked["score"] == pytest.approx(0.75 * 70 + 0.25 * 100)
    assert sum(ranked["breakdown"].values()) == pytest.approx(ranked["score"])
    with pytest.raises(ValueError):
        rank_rotations([item], weights, 1.5)


# EcoCrop corn thresholds as stored in ecocrop.parquet (the test only needs ordered bounds)
ROW = pd.Series(
    {"tmin": 10, "topmn": 18, "topmx": 33, "tmax": 47, "rmin": 400, "ropmn": 600, "ropmx": 1200, "rmax": 1800}
)


def test_cold_month_limits_the_season_instead_of_being_averaged_away() -> None:
    temps = [8.0] * 30 + [24.0] * 120
    rain = [5.0] * 150
    # Whole window is the season: the 8 C month is below tmin, even though the mean (20.8 C) is optimal
    whole = season_fit(temps, rain, ROW, None)
    assert whole["s_t"] == 0 and whole["t_limiting"] == pytest.approx(8.0)
    # A 120-day crop can start after the cold month
    shorter = season_fit(temps, rain, ROW, 120)
    assert shorter["s_t"] == 100 and shorter["offset"] > 0 and shorter["rain"] == pytest.approx(600)


def test_short_window_rain_is_extrapolated_to_cycle_length() -> None:
    result = season_fit([24.0] * 60, [5.0] * 60, ROW, 120)
    assert result["extrapolated"] and result["rain"] == pytest.approx(600)
