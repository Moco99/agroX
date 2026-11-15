"""Sentinel-2 BOA offset applies only to products generated with baseline >= 04.00 (from 2022-01-25)."""

import sys
from pathlib import Path

# pipeline/ lives at the repo root, outside the backend package
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from pipeline.build_ndvi import S2_BOA_OFFSET, s2_offset  # noqa: E402


def test_offset_by_generation_date() -> None:
    # 2021 acquisition, generated in 2021 (baseline 03.00): raw DN, no offset
    assert s2_offset("S2B_MSIL2A_20210730T165849_R069_T15TVG_20210731T021014") == 0.0
    # 2024 acquisition (baseline 05.11): offset
    assert s2_offset("S2A_MSIL2A_20240729T165851_R069_T15TVG_20240730T002233") == S2_BOA_OFFSET
    # Boundary: first day of baseline 04.00
    assert s2_offset("S2A_MSIL2A_20220124T170000_R069_T15TVG_20220125T010000") == S2_BOA_OFFSET
    # 2022 acquisition reprocessed in 2024 (baseline 05.10): offset
    assert s2_offset("S2A_MSIL2A_20220730T165901_R069_T15TVG_20240716T000000") == S2_BOA_OFFSET


def test_shared_ndvi_math_respects_product_offset() -> None:
    import numpy as np

    from app.engine.ndvi import compute_ndvi

    red = np.array([[2000.0]])
    nir = np.array([[6000.0]])
    scl = np.array([[4]])
    early, _ = compute_ndvi(red, nir, scl, offset=0)
    modern, _ = compute_ndvi(red, nir, scl, offset=S2_BOA_OFFSET)
    assert np.isclose(early[0, 0], .5)
    assert np.isclose(modern[0, 0], 2 / 3)
