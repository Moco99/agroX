"""Contract: Real* and Synthetic* adapters return the same models and satisfy the same invariants."""

from __future__ import annotations

from datetime import date

import pytest

from app.providers.factory import Providers
from app.providers.ports import DataNotFoundError
from app.schemas.common import DataState
from app.schemas.crops import CropCatalog
from app.schemas.farm import Farm
from app.schemas.observations import NdviOverlay, ObservationSeries, ObservationVariable
from app.schemas.weather import WeatherSeries
from tests.conftest import provider_sets

FARM = "story_pilot_farm"


@pytest.fixture(params=provider_sets(), ids=lambda p: p.mode)
def p(request: pytest.FixtureRequest) -> Providers:
    return request.param  # type: ignore[no-any-return]


def _is_synthetic(p: Providers) -> bool:
    return p.mode == "synthetic"


def test_weather_contract(p: Providers) -> None:
    series = p.weather.get_daily(date(2024, 1, 1), date(2024, 12, 31))
    assert isinstance(series, WeatherSeries)
    assert len(series.days) == 366
    assert all(d.precip >= 0 and d.t_min <= d.t_max and 0 <= d.rh_mean <= 100 for d in series.days)
    dates = [d.date for d in series.days]
    assert dates == sorted(dates)
    # Synthetic data must never pass as measured, and real data never as synthetic
    assert (series.provenance.data_state is DataState.SYNTHETIC) == _is_synthetic(p)
    start, end = p.weather.coverage()
    assert start <= date(2023, 1, 1) and end >= date(2024, 12, 31)


def test_soil_and_farm_contract(p: Providers) -> None:
    farm = p.farm.get_farm(FARM)
    assert isinstance(farm, Farm)
    assert 1 <= len(farm.zones) <= 4
    soils = p.soil.get_zone_soils(FARM)
    for z in farm.zones:
        assert z.zone_id in soils
        assert z.area_ha > 0
        assert z.crop_id in {"corn", "soybean"}
        assert 50 <= z.soil.awc_mm_per_m <= 300
        assert z.soil.verified is False
        assert (z.soil.provenance.data_state is DataState.SYNTHETIC) == _is_synthetic(p)
        assert {h.crop_id for h in z.cdl_history} <= {"corn", "soybean"}
    with pytest.raises(DataNotFoundError):
        p.farm.get_farm("does_not_exist")


def test_catalog_contract(p: Providers) -> None:
    cat = p.catalog.get_catalog()
    assert isinstance(cat, CropCatalog)
    assert {c.crop_id for c in cat.crops} >= {"corn", "soybean", "cereal_rye"}
    # Literature values are never presented as verified
    assert all(c.verified is False for c in cat.crops)
    assert cat.provenance.data_state in (DataState.ESTIMATED, DataState.SYNTHETIC)


def test_observation_contract(p: Providers) -> None:
    for source_id in p.observations.ndvi_sources():
        s = p.observations.ndvi_series(FARM, source_id)
        assert isinstance(s, ObservationSeries)
        assert s.variable is ObservationVariable.NDVI
        assert s.points and all(-1.0 <= pt.value <= 1.0 and pt.zone_id for pt in s.points)
    sm = p.observations.soil_moisture(FARM)
    assert sm.variable is ObservationVariable.SOIL_MOISTURE
    assert all(0.0 <= pt.value <= 0.6 for pt in sm.points)
    overlay = p.observations.ndvi_overlay(FARM)
    assert overlay is None or isinstance(overlay, NdviOverlay)
    with pytest.raises(DataNotFoundError):
        p.observations.ndvi_series(FARM, "landsat")
