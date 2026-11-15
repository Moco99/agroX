"""Write derived/catalog/catalog_v1.json for the pilot crops.

Every numeric value below is a *provisional* literature value (FAO-56 tables,
US extension conventions) that has NOT been reviewed by an agronomist for this
pilot: `verified` is false and each `sources` entry says "to verify". The engine
treats verified=false as a warning and labels derived outputs ESTIMATED.
"""

from __future__ import annotations

from typing import Any

from pipeline.common import DERIVED_DIR, register_artifact, relative_to_derived, write_json

TO_VERIFY_FAO56 = "FAO-56 (Allen et al. 1998) Tables 11/12/22 (to verify against the pilot)"
TO_VERIFY_EXT = "US Corn Belt extension conventions (to verify, e.g. Iowa State Extension)"

CATALOG: dict[str, Any] = {
    "catalog_version": "catalog_v1",
    "data_state": "ESTIMATED",
    "notes": [
        "Provisional parameters: verified=false on every crop until sources are reviewed.",
        "gdd thresholds are cumulative degree-days (C-day) from planting at which each stage starts.",
        "irrigation and runoff rules live in the engine as product configuration, not here.",
    ],
    "crops": [
        {
            "crop_id": "corn",
            "name_es": "Maíz",
            "name_en": "Corn (grain)",
            "family": "Poaceae",
            "crop_type": "CASH_CROP",
            "fixes_nitrogen": False,
            "cycle_days": 150,
            "planting_window": {"start_mmdd": "04-20", "end_mmdd": "05-25"},
            "t_min": 10.0,
            "t_opt": 25.0,
            "t_max": 35.0,
            "t_base_gdd": 10.0,
            "t_cap_gdd": 30.0,
            "gdd_stages": {"initial": 0.0, "development": 200.0, "mid": 650.0, "late": 1150.0, "maturity": 1450.0},
            "stage_lengths_days": {"initial": 30, "development": 40, "mid": 50, "late": 30},
            "water_need_mm": 550.0,
            "kc_ini": 0.30,
            "kc_mid": 1.20,
            "kc_end": 0.60,
            "root_depth_min_m": 0.20,
            "root_depth_max_m": 1.20,
            "depletion_fraction_p": 0.55,
            "canopy_ndvi_hint": {"bare": 0.20, "full": 0.85},
            "sources": [TO_VERIFY_FAO56, TO_VERIFY_EXT, "GDD base 10 C / cap 30 C = US modified method (to verify)"],
            "verified": False,
        },
        {
            "crop_id": "soybean",
            "name_es": "Soya",
            "name_en": "Soybean",
            "family": "Fabaceae",
            "crop_type": "CASH_CROP",
            "fixes_nitrogen": True,
            "cycle_days": 135,
            "planting_window": {"start_mmdd": "05-01", "end_mmdd": "06-05"},
            "t_min": 10.0,
            "t_opt": 26.0,
            "t_max": 35.0,
            "t_base_gdd": 10.0,
            "t_cap_gdd": 30.0,
            "gdd_stages": {"initial": 0.0, "development": 150.0, "mid": 550.0, "late": 1050.0, "maturity": 1300.0},
            "stage_lengths_days": {"initial": 20, "development": 30, "mid": 60, "late": 25},
            "water_need_mm": 500.0,
            "kc_ini": 0.40,
            "kc_mid": 1.15,
            "kc_end": 0.50,
            "root_depth_min_m": 0.20,
            "root_depth_max_m": 1.00,
            "depletion_fraction_p": 0.50,
            "canopy_ndvi_hint": {"bare": 0.20, "full": 0.85},
            "sources": [TO_VERIFY_FAO56, TO_VERIFY_EXT],
            "verified": False,
        },
        {
            "crop_id": "cereal_rye",
            "name_es": "Centeno (cobertura)",
            "name_en": "Cereal rye (cover crop)",
            "family": "Poaceae",
            "crop_type": "COVER_CROP",
            "fixes_nitrogen": False,
            "cycle_days": 210,
            "planting_window": {"start_mmdd": "09-15", "end_mmdd": "10-31"},
            "t_min": 0.0,
            "t_opt": 20.0,
            "t_max": 32.0,
            "t_base_gdd": 0.0,
            "t_cap_gdd": None,
            "gdd_stages": {"initial": 0.0, "development": 300.0, "mid": 900.0, "late": 1400.0, "maturity": 1700.0},
            "stage_lengths_days": {"initial": 30, "development": 90, "mid": 60, "late": 30},
            "water_need_mm": 350.0,
            "kc_ini": 0.30,
            "kc_mid": 1.10,
            "kc_end": 0.30,
            "root_depth_min_m": 0.15,
            "root_depth_max_m": 1.00,
            "depletion_fraction_p": 0.55,
            "canopy_ndvi_hint": {"bare": 0.20, "full": 0.75},
            "sources": [TO_VERIFY_FAO56, "SARE / USDA-NRCS cover crop guides (to verify)"],
            "verified": False,
        },
    ],
}


def build() -> None:
    out_path = DERIVED_DIR / "catalog" / "catalog_v1.json"
    write_json(out_path, CATALOG)
    register_artifact(
        "crop_catalog_v1",
        {
            "files": [relative_to_derived(out_path)],
            "data_state": "ESTIMATED",
            "source_id": "literature",
            "verified": False,
            "crops": [c["crop_id"] for c in CATALOG["crops"]],
        },
    )
    print(f"[catalog] {[c['crop_id'] for c in CATALOG['crops']]} (verified=false)")


if __name__ == "__main__":
    build()
