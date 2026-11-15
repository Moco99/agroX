"""GlobalFarmProvider: the pilot farms from derived/ plus a "point farm" anywhere on Earth.

`pt_<lat>_<lon>` builds a 36 ha square of four 9 ha zones centred on the point, with terrain from the
Copernicus DEM (30 m, global) and soil from LiveSoilProvider (SoilGrids where there is no SSURGO).
There is no global crop map with per-field crop types, so the crop is DECLARED: maize by default, and the
farmer is expected to change it. Weather and NDVI for the same id come from the other live adapters.
"""

from __future__ import annotations

import json
import math
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from app.engine.config import erosion_index_for
from app.providers.live.parcel import (
    ZONE_NAMES,
    Ring,
    cached,
    centroid,
    custom_rings,
    is_polygon_farm,
    point_farm,
    ring_area_ha,
    rings_bbox,
)
from app.providers.ports import SoilProvider
from app.providers.real.farm import RealFarmProvider
from app.schemas.common import DataState, Location, Provenance
from app.schemas.farm import Farm, FarmZone, PolygonGeometry, TerrainInfo

PC = "https://planetarycomputer.microsoft.com/api"
DEM = "cop-dem-glo-30"
SLOPE_STEP_M = 30.0
DEFAULT_CROP = "corn"

Elevation = Callable[[float, float], float]


def _get(url: str, body: dict[str, object] | None = None) -> object:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"User-Agent": "agrox-backend", "Content-Type": "application/json"}
    )
    # 20 DEM samples per farm run in parallel: a hung call must not hold the farm response for minutes
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def dem_elevation(lat: float, lon: float) -> float:
    search = _get(
        f"{PC}/stac/v1/search", {"collections": [DEM], "intersects": {"type": "Point", "coordinates": [lon, lat]}}
    )
    assert isinstance(search, dict)
    item = search["features"][0]["id"]
    point = _get(f"{PC}/data/v1/item/point/{lon},{lat}?collection={DEM}&item={item}&assets=data")
    assert isinstance(point, dict)
    return float(point["values"][0])


def zone_terrain(ring: Ring, elevation: Elevation) -> dict[str, float]:
    """Elevation and slope (%) at the zone centre by central differences on the 30 m DEM."""
    lon, lat = centroid(ring)
    dlat = SLOPE_STEP_M / 111320
    dlon = SLOPE_STEP_M / (111320 * math.cos(math.radians(lat)))
    pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
    z = [elevation(*p) for p in pts]
    dzdx = (z[3] - z[4]) / (2 * SLOPE_STEP_M)
    dzdy = (z[1] - z[2]) / (2 * SLOPE_STEP_M)
    return {"elevation": round(z[0], 1), "slope_pct": round(math.hypot(dzdx, dzdy) * 100, 2)}


def _polygon(ring: Ring) -> PolygonGeometry:
    return PolygonGeometry(coordinates=[[[x, y] for x, y in ring]])


def _terrain_info(values: dict[str, float] | None, error: str | None) -> TerrainInfo:
    if values is None:
        return TerrainInfo(
            elevation_mean_m=None,
            slope_mean_pct=None,
            slope_max_pct=None,
            erosion_index=erosion_index_for(None),
            data_state=DataState.ESTIMATED,
            warnings=[f"Copernicus DEM unavailable ({error}); weather-cell elevation used by the twin"],
        )
    return TerrainInfo(
        elevation_mean_m=values["elevation"],
        slope_mean_pct=values["slope_pct"],
        slope_max_pct=None,
        erosion_index=erosion_index_for(values["slope_pct"]),
        data_state=DataState.MEASURED,
        warnings=["slope from 5 DEM samples at the zone centre (30 m), not a zone-wide statistic"],
    )


class GlobalFarmProvider(RealFarmProvider):
    def __init__(
        self,
        derived_dir: Path,
        soil: SoilProvider,
        cache_dir: Path,
        elevation: Elevation = dem_elevation,
        today: Callable[[], date] = date.today,
    ) -> None:
        super().__init__(derived_dir, soil)
        self._cache_dir = cache_dir
        self._elevation, self._today = elevation, today

    def get_farm(self, farm_id: str) -> Farm:
        pt = point_farm(farm_id)
        if pt is None:
            return super().get_farm(farm_id)
        lat, lon = pt
        rings = custom_rings(farm_id)
        assert rings is not None
        drawn = is_polygon_farm(farm_id)

        def build() -> dict[str, dict[str, float]]:
            with ThreadPoolExecutor(len(rings)) as ex:
                return dict(zip(rings, ex.map(lambda r: zone_terrain(r, self._elevation), rings.values()), strict=True))

        terrain_error: str | None = None
        try:
            terrain: dict[str, dict[str, float]] = cached(self._cache_dir, f"terrain_{farm_id}", build, self._today())
        except Exception as exc:
            # The DEM is one source among several: without it the farm still opens, with unknown terrain
            terrain, terrain_error = {}, f"{type(exc).__name__}: {str(exc)[:120]}"
        soils = self._soil.get_zone_soils(farm_id)
        zones = [
            FarmZone(
                zone_id=zid,
                name=f"Lote {zid.removeprefix('zone_')}" if drawn else ZONE_NAMES[zid],
                crop_id=DEFAULT_CROP,
                area_ha=round(ring_area_ha(ring), 2),
                geometry=_polygon(ring),
                centroid=Location(lat=centroid(ring)[1], lon=centroid(ring)[0]),
                soil=soils[zid],
                terrain=_terrain_info(terrain.get(zid), terrain_error),
                data_state=DataState.DECLARED,
            )
            for zid, ring in rings.items()
        ]
        w, s, e, n = rings_bbox(list(rings.values()))
        outline = [(w, s), (e, s), (e, n), (w, n), (w, s)]
        if drawn and len(rings) == 1:
            outline = next(iter(rings.values()))
        parcel = (
            Provenance(
                source="AGROX drawn farm (polygons drawn by the user on the map)",
                data_state=DataState.DECLARED,
                method="one zone per drawn polygon; area by shoelace on a local equirectangular projection "
                "(approximate geodesic)",
            )
            if drawn
            else Provenance(
                source="AGROX point farm (36 ha square around the selected point)",
                data_state=DataState.DECLARED,
                method="2x2 zones of 300 m; not a surveyed property line",
            )
        )
        boundary_note = (
            "drawn farm: boundary drawn by the user (DECLARED); farm outline is the bounding box when there are "
            "several polygons; soil is one SoilGrids sample at the farm centre and terrain one DEM sample per zone"
            if drawn
            else "point farm: boundary is a 36 ha square around the selected point, not a surveyed property line"
        )
        return Farm(
            farm_id=farm_id,
            name=f"Parcela dibujada en {lat:.4f}, {lon:.4f}" if drawn else f"Parcela en {lat:.4f}, {lon:.4f}",
            area_ha=round(sum(z.area_ha for z in zones), 2),
            centroid=Location(lat=lat, lon=lon),
            geometry=_polygon(outline),
            zones=zones,
            provenance={
                "parcel": parcel,
                "terrain": Provenance(
                    source="Copernicus DEM GLO-30 (Planetary Computer)", data_state=DataState.MEASURED
                ),
                "soil": zones[0].soil.provenance,
            },
            warnings=[
                boundary_note,
                f"crop not observed: '{DEFAULT_CROP}' assumed (DECLARED); declare the real crop per zone (zone_crops)",
                "planting dates are a hemisphere calendar suggestion (ESTIMATED): declare them (planting_dates)",
                *([f"terrain unavailable (Copernicus DEM: {terrain_error})"] if terrain_error else []),
            ],
        )
