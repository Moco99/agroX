"""Pure rotation building blocks. Indicators must come from the twin/catalog.

These functions do not validate planting calendars, water availability or field
outcomes. Same-family exclusion is an optional product rule, not a universal law.
"""

import math
from collections.abc import Collection, Mapping, Sequence
from itertools import product
from typing import Any

# ─────────────────────────────────────────
# Section: Rotation-level product parameters
# ─────────────────────────────────────────

# Why a rotation component exists: the agro-climatic index scores each cycle alone, so the single best crop
# repeated always wins. The criteria below follow well-documented rotation principles: breaking the
# sequence of a crop and of its botanical family interrupts host-specific pests and diseases, legumes
# before non-legumes leave biologically fixed N, and more families diversify the system.
# Refs: USDA-NRCS Conservation Practice Standard 328 "Conservation Crop Rotation"; Bullock (1992) Crit.
# Rev. Plant Sci. 11:309-326; Karlen et al. (1994) Adv. Agron. 53:1-45; Peoples et al. (2009) Symbiosis
# 48:1-17; FAO (2011) "Save and Grow". The magnitudes below are PRODUCT weights for a comparative index,
# not measured agronomic effects (no yield or N credit in kg/ha is claimed).
TRANSITION_SCORES = {"different_family": 100.0, "same_family": 50.0, "same_crop": 0.0}
ROTATION_COMPONENT_WEIGHTS = {"family_break": 0.5, "legume_before_non_legume": 0.25, "family_diversity": 0.25}
# Share of the final index given to the rotation component by default (product parameter).
DEFAULT_ROTATION_WEIGHT = 0.3


def generate_candidates(
    crop_families: Mapping[str, str],
    cycles: int = 3,
    previous_crop: str | None = None,
    exclude_same_family: bool = False,
    exclude_same_crop: bool = False,
) -> list[list[str]]:
    if type(cycles) is not int or not 2 <= cycles <= 4:
        raise ValueError("cycles must be an integer between 2 and 4")
    if not crop_families or len(crop_families) > 12:
        raise ValueError("Supply 1 to 12 crops with known families")
    if any(not isinstance(family, str) or not family.strip() for family in crop_families.values()):
        raise ValueError("Every crop needs a known family")
    if previous_crop is not None and previous_crop not in crop_families:
        raise ValueError("previous_crop must belong to the catalog")
    candidates = []
    for sequence in product(sorted(crop_families), repeat=cycles):
        history = ((previous_crop,) if previous_crop is not None else ()) + sequence
        pairs = list(zip(history, history[1:], strict=False))
        if exclude_same_family and any(crop_families[a] == crop_families[b] for a, b in pairs):
            continue
        if exclude_same_crop and any(a == b for a, b in pairs):
            continue
        candidates.append(list(sequence))
    return candidates


def rotation_quality(
    sequence: Sequence[str],
    families: Mapping[str, str],
    legumes: Collection[str],
    previous_crop: str | None = None,
) -> dict[str, Any]:
    """Rotation index 0-100 from the sequence alone (plus the declared previous crop), with its components."""
    if len(sequence) < 2:
        raise ValueError("A rotation needs at least two cycles")
    history = ([previous_crop] if previous_crop is not None else []) + list(sequence)
    pairs = list(zip(history, history[1:], strict=False))

    def transition(a: str, b: str) -> float:
        if a == b:
            return TRANSITION_SCORES["same_crop"]
        if families[a] == families[b]:
            return TRANSITION_SCORES["same_family"]
        return TRANSITION_SCORES["different_family"]

    legume_first = sum(a in legumes and b not in legumes for a, b in pairs)
    distinct = len({families[c] for c in sequence})
    components = {
        "family_break": sum(transition(a, b) for a, b in pairs) / len(pairs),
        "legume_before_non_legume": 100.0 * legume_first / len(pairs),
        "family_diversity": 100.0 * (distinct - 1) / (len(sequence) - 1),
    }
    return {
        "index": sum(ROTATION_COMPONENT_WEIGHTS[key] * value for key, value in components.items()),
        "components": components,
        "component_weights": dict(ROTATION_COMPONENT_WEIGHTS),
        "counts": {
            "transitions": len(pairs),
            "same_crop": sum(a == b for a, b in pairs),
            "same_family": sum(a != b and families[a] == families[b] for a, b in pairs),
            "legume_before_non_legume": legume_first,
            "families": distinct,
        },
    }


def select_diverse(ranked: Sequence[dict[str, Any]], k: int) -> list[dict[str, Any]]:
    """Top-k in rank order, skipping near-duplicates (same set of crops) while real alternatives remain.

    E.g. corn-bean-corn and bean-corn-bean use the same crops; listing both hides a different option.
    """
    distinct: list[int] = []
    seen: set[frozenset[str]] = set()
    for index, item in enumerate(ranked):
        crops = frozenset(item["sequence"])
        if crops not in seen and len(distinct) < k:
            seen.add(crops)
            distinct.append(index)
    # Not enough distinct crop sets: fill with the best remaining candidates
    taken = set(distinct)
    rest = [index for index in range(len(ranked)) if index not in taken][: k - len(distinct)]
    return [ranked[index] for index in sorted(distinct + rest)]


def rank_rotations(
    evaluated: Sequence[dict[str, Any]], weights: Mapping[str, float], rotation_weight: float = 0.0
) -> list[dict[str, Any]]:
    """Rank precomputed A/Ssoil/C indices plus an optional rotation component; return weights and breakdown.

    score = (1 - rotation_weight) * agroclimatic_score + rotation_weight * rotation["index"].
    """
    keys = {"water", "soil", "climate"}
    if set(weights) != keys:
        raise ValueError("Provide water, soil and climate weights")
    if any(not math.isfinite(v) or v < 0 for v in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("Weights must be finite, nonnegative and have a positive sum")
    if not math.isfinite(rotation_weight) or not 0 <= rotation_weight <= 1:
        raise ValueError("rotation_weight must be between 0 and 1")
    scale = max(weights.values())
    scaled = {key: value / scale for key, value in weights.items()}
    total = sum(scaled.values())
    normalized = {key: value / total for key, value in scaled.items()}
    ranked = []
    for item in evaluated:
        indicators = item["indicators"]
        if set(indicators) != keys or any(not math.isfinite(v) or not 0 <= v <= 100 for v in indicators.values()):
            raise ValueError("Indicators must be finite and between 0 and 100")
        breakdown = {key: (1 - rotation_weight) * normalized[key] * indicators[key] for key in sorted(keys)}
        rotation = item.get("rotation")
        if rotation is not None:
            breakdown["rotation"] = rotation_weight * rotation["index"]
        elif rotation_weight > 0:
            raise ValueError("A rotation component is required when rotation_weight > 0")
        ranked.append(
            {
                **item,
                "weights": normalized.copy(),
                "rotation_weight": rotation_weight,
                "agroclimatic_score": sum(normalized[key] * indicators[key] for key in keys),
                "breakdown": breakdown,
                "score": sum(breakdown.values()),
                "score_type": "comparative_index",
            }
        )
    return sorted(ranked, key=lambda item: (-item["score"], tuple(item["sequence"])))
