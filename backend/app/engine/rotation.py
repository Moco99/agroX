"""Pure rotation building blocks. Indicators must come from the twin/catalog.

These functions do not validate planting calendars, water availability or field
outcomes. Same-family exclusion is an optional product rule, not a universal law.
"""
from itertools import product
import math


def generate_candidates(crop_families, cycles=3, previous_crop=None, exclude_same_family=False):
    if type(cycles) is not int or not 2 <= cycles <= 4:
        raise ValueError("cycles must be an integer between 2 and 4")
    if not crop_families or len(crop_families) > 12:
        raise ValueError("Supply 1 to 12 crops with known families")
    if any(not family for family in crop_families.values()):
        raise ValueError("Every crop needs a known family")
    if previous_crop is not None and previous_crop not in crop_families:
        raise ValueError("previous_crop must belong to the catalog")
    candidates = []
    for sequence in product(sorted(crop_families), repeat=cycles):
        history = ((previous_crop,) if previous_crop is not None else ()) + sequence
        repeated = any(crop_families[a] == crop_families[b] for a, b in zip(history, history[1:]))
        if exclude_same_family and repeated:
            continue
        candidates.append(list(sequence))
    return candidates


def rank_rotations(evaluated, weights):
    """Rank precomputed A/Ssoil/C indices; return normalized weights and breakdown."""
    keys = {"water", "soil", "climate"}
    if set(weights) != keys:
        raise ValueError("Provide water, soil and climate weights")
    if any(not math.isfinite(v) or v < 0 for v in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("Weights must be finite, nonnegative and have a positive sum")
    total = sum(weights.values())
    normalized = {key: value / total for key, value in weights.items()}
    ranked = []
    for item in evaluated:
        indicators = item["indicators"]
        if set(indicators) != keys or any(not math.isfinite(v) or not 0 <= v <= 100 for v in indicators.values()):
            raise ValueError("Indicators must be finite and between 0 and 100")
        breakdown = {key: normalized[key] * indicators[key] for key in sorted(keys)}
        ranked.append({**item, "weights": normalized.copy(), "breakdown": breakdown,
                       "score": sum(breakdown.values()), "score_type": "comparative_index"})
    return sorted(ranked, key=lambda item: (-item["score"], tuple(item["sequence"])))
