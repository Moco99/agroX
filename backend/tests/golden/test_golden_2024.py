"""Golden: the 2024 baseline per zone must not change unintentionally.

Regenerate on purpose with `AGROX_UPDATE_GOLDEN=1 pytest tests/golden` and justify the diff in the PR.
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import pytest

from app.providers.factory import Providers
from app.schemas.twin import TwinSimulateRequest
from app.services.twin_service import simulate
from tests.conftest import provider_sets

GOLDEN_DIR = Path(__file__).parent / "data"


def _snapshot(p: Providers) -> dict[str, object]:
    resp = simulate(p, TwinSimulateRequest(start=date(2024, 4, 1), end=date(2024, 10, 31), include_comparison=False))
    zones: dict[str, object] = {}
    for z in resp.zones:
        zones[z.zone_id] = {
            "crop_id": z.crop_id,
            "planting_date": z.planting_date.isoformat(),
            "summary": z.summary.model_dump(mode="json"),
            "states_sample": [s.model_dump(mode="json") for s in z.states[::30]],
        }
    return {
        "twin_level": resp.twin_level.value,
        "farm_summary": resp.farm_summary.model_dump(mode="json"),
        "zones": zones,
    }


@pytest.mark.parametrize("p", provider_sets(), ids=lambda p: p.mode)
def test_golden_2024(p: Providers) -> None:
    path = GOLDEN_DIR / f"twin_2024_{p.mode}.json"
    current = _snapshot(p)
    if os.environ.get("AGROX_UPDATE_GOLDEN") == "1" or not path.exists():
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(current, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    expected = json.loads(path.read_text(encoding="utf-8"))
    assert current == expected
