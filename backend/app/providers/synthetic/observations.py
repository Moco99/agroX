"""SyntheticObservationProvider: double-logistic NDVI (model 16) with noise and cloud gaps; synthetic SMAP."""

from __future__ import annotations

import math
from datetime import date, timedelta

from app.providers.ports import DataNotFoundError
from app.providers.synthetic import params as P
from app.providers.synthetic import rng_for, source
from app.providers.synthetic.farm import SYNTHETIC_FARM_ID
from app.schemas.common import DataState, Provenance
from app.schemas.observations import NdviOverlay, ObservationPoint, ObservationSeries, ObservationVariable

# Revisit interval in days per synthetic source (MODIS-like composite, Sentinel-2-like revisit)
_REVISIT = {"modis_ndvi": (16, 250.0), "sentinel2": (5, 10.0)}


def _double_logistic(doy: int, crop: str) -> float:
    up = 1.0 / (1.0 + math.exp(-P.NDVI_SLOPE * (doy - P.NDVI_GREENUP_DOY[crop])))
    down = 1.0 / (1.0 + math.exp(-P.NDVI_SLOPE * (doy - P.NDVI_SENESCENCE_DOY[crop])))
    return P.NDVI_BARE + (P.NDVI_PEAK[crop] - P.NDVI_BARE) * (up - down)


def _check(farm_id: str) -> None:
    if farm_id != SYNTHETIC_FARM_ID:
        raise DataNotFoundError(f"unknown farm '{farm_id}'")


class SyntheticObservationProvider:
    def __init__(self, seed: int) -> None:
        self._seed = seed

    def ndvi_sources(self) -> list[str]:
        return list(_REVISIT)

    def ndvi_series(self, farm_id: str, source_id: str) -> ObservationSeries:
        _check(farm_id)
        if source_id not in _REVISIT:
            raise DataNotFoundError(f"unknown NDVI source '{source_id}'")
        step, resolution = _REVISIT[source_id]
        rng = rng_for(self._seed, f"ndvi:{source_id}")
        points: list[ObservationPoint] = []
        d = date(2024, 1, 1)
        while d <= date(2024, 12, 31):
            for zone_id, _name, crop, _row, _col in P.ZONES:
                gap = rng.uniform() < P.CLOUD_GAP_PROBABILITY
                value = _double_logistic(d.timetuple().tm_yday, crop) + float(rng.normal(0.0, P.NDVI_NOISE_SD))
                if gap:
                    continue
                points.append(
                    ObservationPoint(
                        date=d,
                        variable=ObservationVariable.NDVI,
                        value=round(min(1.0, max(-0.2, value)), 4),
                        zone_id=zone_id,
                        n_pixels=None,
                        qa_flag="synthetic",
                    )
                )
            d += timedelta(days=step)
        return ObservationSeries(
            variable=ObservationVariable.NDVI,
            source_id=source_id,
            resolution_m=resolution,
            points=points,
            provenance=Provenance(source=source(f"ndvi_{source_id}"), data_state=DataState.SYNTHETIC),
            warnings=["synthetic NDVI: does not represent the real parcel"],
        )

    def soil_moisture(self, farm_id: str) -> ObservationSeries:
        _check(farm_id)
        rng = rng_for(self._seed, "smap")
        points: list[ObservationPoint] = []
        d = date(2023, 1, 1)
        while d <= date(2024, 12, 31):
            if rng.uniform() > 0.45:
                season = math.cos(2.0 * math.pi * (d.timetuple().tm_yday - 120) / 365.25)
                value = P.SMAP_MEAN + 0.04 * season + float(rng.normal(0.0, P.SMAP_SD))
                points.append(
                    ObservationPoint(
                        date=d,
                        variable=ObservationVariable.SOIL_MOISTURE,
                        value=round(min(0.5, max(0.02, value)), 4),
                        qa_flag="synthetic",
                    )
                )
            d += timedelta(days=1)
        return ObservationSeries(
            variable=ObservationVariable.SOIL_MOISTURE,
            source_id="smap",
            resolution_m=9000.0,
            points=points,
            provenance=Provenance(source=source("smap"), data_state=DataState.SYNTHETIC),
            warnings=["synthetic soil moisture: does not represent the real parcel"],
        )

    def ndvi_overlay(self, farm_id: str) -> NdviOverlay | None:
        _check(farm_id)
        # No synthetic raster: the UI shows zone means only and says the overlay is unavailable
        return None
