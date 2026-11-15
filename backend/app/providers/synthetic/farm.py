"""Synthetic soil and farm adapters: fixed loam profile and a 2 x 2 grid of 36 ha zones."""

from __future__ import annotations

from app.providers.ports import DataNotFoundError, SoilProvider
from app.providers.synthetic import params as P
from app.providers.synthetic import source
from app.schemas.common import DataState, Location, Provenance
from app.schemas.farm import CdlYear, Farm, FarmZone, PolygonGeometry, TerrainInfo
from app.schemas.soil import SoilProfile

SYNTHETIC_FARM_ID = "story_pilot_farm"
_OTHER = {"corn": "soybean", "soybean": "corn"}
_CDL = {"corn": 1, "soybean": 5}


def _square(west: float, south: float) -> PolygonGeometry:
    east, north = west + P.ZONE_SIZE_DEG_LON, south + P.ZONE_SIZE_DEG_LAT
    return PolygonGeometry(coordinates=[[[west, south], [east, south], [east, north], [west, north], [west, south]]])


class SyntheticSoilProvider:
    def get_zone_soils(self, farm_id: str) -> dict[str, SoilProfile]:
        if farm_id != SYNTHETIC_FARM_ID:
            raise DataNotFoundError(f"unknown farm '{farm_id}'")
        profile = SoilProfile(
            awc_mm_per_m=P.SOIL_AWC_MM_PER_M,
            root_depth_max_m=P.SOIL_ROOT_LIMIT_M,
            texture=P.SOIL_TEXTURE,
            drainage_class=P.SOIL_DRAINAGE,
            hydrologic_group=P.SOIL_HYDGRP,
            map_unit_name="Synthetic loam",
            component_name="synthetic",
            provenance=Provenance(source=source("soil"), data_state=DataState.SYNTHETIC, version=P.GENERATOR_VERSION),
            verified=False,
            warnings=["synthetic soil: does not represent the real parcel"],
        )
        return {zone_id: profile for zone_id, *_ in P.ZONES}


class SyntheticFarmProvider:
    def __init__(self, soil: SoilProvider) -> None:
        self._soil = soil

    def farm_ids(self) -> list[str]:
        return [SYNTHETIC_FARM_ID]

    def get_farm(self, farm_id: str) -> Farm:
        soils = self._soil.get_zone_soils(farm_id)
        west0 = P.LON - P.ZONE_SIZE_DEG_LON
        north0 = P.LAT + P.ZONE_SIZE_DEG_LAT
        zones: list[FarmZone] = []
        for zone_id, name, crop, row, col in P.ZONES:
            west = west0 + col * P.ZONE_SIZE_DEG_LON
            south = north0 - (row + 1) * P.ZONE_SIZE_DEG_LAT
            # Strict corn-soybean alternation backwards from 2024
            history = [
                CdlYear(year=y, cdl_code=_CDL[c], crop_id=c, purity=1.0)
                for y in range(2021, 2025)
                for c in [crop if (2024 - y) % 2 == 0 else _OTHER[crop]]
            ]
            zones.append(
                FarmZone(
                    zone_id=zone_id,
                    name=name,
                    crop_id=crop,
                    crop_purity=1.0,
                    area_ha=36.0,
                    geometry=_square(west, south),
                    centroid=Location(lat=south + P.ZONE_SIZE_DEG_LAT / 2, lon=west + P.ZONE_SIZE_DEG_LON / 2),
                    soil=soils[zone_id],
                    terrain=TerrainInfo(
                        elevation_mean_m=P.ELEVATION_M + row * 2.0,
                        slope_mean_pct=1.5 + row + col,
                        slope_max_pct=4.0 + row + col,
                        erosion_index="low" if row + col == 0 else "moderate",
                        data_state=DataState.SYNTHETIC,
                    ),
                    cdl_history=history,
                    data_state=DataState.SYNTHETIC,
                )
            )
        prov = Provenance(source=source("farm"), data_state=DataState.SYNTHETIC, version=P.GENERATOR_VERSION)
        return Farm(
            farm_id=farm_id,
            name="Granja sintética",
            area_ha=144.0,
            centroid=Location(lat=P.LAT, lon=P.LON),
            geometry=PolygonGeometry(
                coordinates=[
                    [
                        [west0, north0 - 2 * P.ZONE_SIZE_DEG_LAT],
                        [west0 + 2 * P.ZONE_SIZE_DEG_LON, north0 - 2 * P.ZONE_SIZE_DEG_LAT],
                        [west0 + 2 * P.ZONE_SIZE_DEG_LON, north0],
                        [west0, north0],
                        [west0, north0 - 2 * P.ZONE_SIZE_DEG_LAT],
                    ]
                ]
            ),
            zones=zones,
            provenance={"parcel": prov, "terrain": prov, "soil": prov},
            warnings=["synthetic farm: does not represent the real parcel"],
        )
