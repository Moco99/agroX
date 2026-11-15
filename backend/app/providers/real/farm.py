"""RealFarmProvider: pilot farm + management zones chosen from CDL 2021-2024 (pipeline/build_parcel.py)."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from app.engine.config import erosion_index_for
from app.providers.ports import DataNotFoundError, SoilProvider
from app.providers.real import provenance_from_manifest, read_json
from app.schemas.common import DataState, Location, Provenance
from app.schemas.farm import CdlYear, Farm, FarmZone, PolygonGeometry, TerrainInfo


def _dict(value: object) -> dict[str, object]:
    return cast(dict[str, object], value) if isinstance(value, dict) else {}


def _float(value: object, default: float = 0.0) -> float:
    return float(value) if isinstance(value, int | float) else default


def _opt_float(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _polygon(geometry: dict[str, object]) -> PolygonGeometry:
    return PolygonGeometry.model_validate(
        {"type": geometry.get("type", "Polygon"), "coordinates": geometry["coordinates"]}
    )


class RealFarmProvider:
    def __init__(self, derived_dir: Path, soil: SoilProvider) -> None:
        self._dir = derived_dir
        self._soil = soil

    def farm_ids(self) -> list[str]:
        folder = self._dir / "parcel"
        return sorted(p.name.removesuffix(".geojson") for p in folder.glob("*.geojson")) if folder.exists() else []

    def _terrain(self, farm_id: str) -> dict[str, TerrainInfo]:
        path = self._dir / "terrain" / f"{farm_id}.json"
        if not path.exists():
            return {}
        doc = read_json(path)
        out: dict[str, TerrainInfo] = {}
        zones = doc.get("zones")
        for z in zones if isinstance(zones, list) else []:
            zd = _dict(z)
            slope = _opt_float(zd.get("slope_mean_pct"))
            out[str(zd.get("zone_id"))] = TerrainInfo(
                elevation_mean_m=_opt_float(zd.get("elevation_mean_m")),
                slope_mean_pct=slope,
                slope_max_pct=_opt_float(zd.get("slope_max_pct")),
                erosion_index=erosion_index_for(slope),
                data_state=DataState.MEASURED,
                warnings=[str(doc.get("note"))] if doc.get("note") else [],
            )
        return out

    def get_farm(self, farm_id: str) -> Farm:
        path = self._dir / "parcel" / f"{farm_id}.geojson"
        if not path.exists():
            raise DataNotFoundError(f"unknown farm '{farm_id}'")
        doc = read_json(path)
        features = doc.get("features")
        feats = [_dict(f) for f in features] if isinstance(features, list) else []
        farm_feat = next((f for f in feats if _dict(f.get("properties")).get("feature_kind") == "farm"), None)
        if farm_feat is None:
            raise DataNotFoundError(f"farm '{farm_id}' has no farm feature")
        soils = self._soil.get_zone_soils(farm_id)
        terrain = self._terrain(farm_id)
        zones: list[FarmZone] = []
        for f in feats:
            props = _dict(f.get("properties"))
            if props.get("feature_kind") != "zone":
                continue
            zone_id = str(props["zone_id"])
            if zone_id not in soils:
                raise DataNotFoundError(f"zone '{zone_id}' has no soil profile")
            centroid = _dict(props.get("centroid"))
            history = props.get("cdl_history")
            zones.append(
                FarmZone(
                    zone_id=zone_id,
                    name=str(props.get("name_es", zone_id)),
                    crop_id=str(props["crop_id"]),
                    crop_purity=_opt_float(props.get("crop_purity_2024")),
                    area_ha=_float(props.get("area_ha")),
                    geometry=_polygon(_dict(f.get("geometry"))),
                    centroid=Location(lat=_float(centroid.get("lat")), lon=_float(centroid.get("lon"))),
                    soil=soils[zone_id],
                    terrain=terrain.get(
                        zone_id,
                        TerrainInfo(
                            elevation_mean_m=None,
                            slope_mean_pct=None,
                            slope_max_pct=None,
                            erosion_index="unknown",
                            data_state=DataState.ESTIMATED,
                            warnings=["terrain not available"],
                        ),
                    ),
                    cdl_history=[CdlYear.model_validate(h) for h in history] if isinstance(history, list) else [],
                    # Pilot zones are rain-fed (CDL does not record irrigation); scenarios can override it
                    data_state=DataState.MEASURED,
                )
            )
        fprops = _dict(farm_feat.get("properties"))
        fcentroid = _dict(fprops.get("centroid"))
        provenance: dict[str, Provenance] = {
            "parcel": provenance_from_manifest(
                self._dir, "parcel_farm", "USDA NASS Cropland Data Layer 30 m (2021-2024)", DataState.MEASURED
            ),
            "terrain": provenance_from_manifest(self._dir, "terrain_slope", "NASADEM 1 arc-second", DataState.MEASURED),
            "soil": next(iter(soils.values())).provenance,
        }
        selection = _dict(fprops.get("selection"))
        return Farm(
            farm_id=farm_id,
            name=str(fprops.get("name_es", farm_id)),
            area_ha=_float(fprops.get("area_ha")),
            centroid=Location(lat=_float(fcentroid.get("lat")), lon=_float(fcentroid.get("lon"))),
            geometry=_polygon(_dict(farm_feat.get("geometry"))),
            zones=zones,
            provenance=provenance,
            warnings=[
                "farm boundary is a pilot window chosen on CDL pixels, not a surveyed property line"
                + (f" ({selection.get('method')})" if selection.get("method") else "")
            ],
        )
