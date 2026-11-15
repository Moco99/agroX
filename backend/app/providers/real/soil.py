"""RealSoilProvider: SSURGO dominant component per zone (pipeline/build_soil.py)."""

from __future__ import annotations

from pathlib import Path

from app.providers.ports import DataNotFoundError
from app.providers.real import provenance_from_manifest, read_json
from app.schemas.common import DataState
from app.schemas.soil import SoilProfile

# Rooting depth used when SSURGO reports no restrictive layer within the described profile.
# DECLARED assumption (decisions.md D-TWIN-04): the crop maximum (1.2 m corn) is then the binding limit.
DEFAULT_ROOT_LIMIT_M = 1.5
# Poorly drained Iowa soils are commonly tile-drained; the balance does not model a water table
SHALLOW_WATER_TABLE_CM = 50.0


def _num(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _str(value: object) -> str | None:
    return str(value) if isinstance(value, str) and value else None


class RealSoilProvider:
    def __init__(self, derived_dir: Path) -> None:
        self._dir = derived_dir

    def _path(self, farm_id: str) -> Path:
        return self._dir / "soil" / f"{farm_id}.json"

    def get_zone_soils(self, farm_id: str) -> dict[str, SoilProfile]:
        path = self._path(farm_id)
        if not path.exists():
            raise DataNotFoundError(f"no soil data for farm '{farm_id}'")
        doc = read_json(path)
        base = provenance_from_manifest(self._dir, "soil_ssurgo", str(doc.get("source", "SSURGO")), DataState.MEASURED)
        base = base.model_copy(update={"method": _str(doc.get("method"))})
        zones = doc.get("zones")
        out: dict[str, SoilProfile] = {}
        for zone in zones if isinstance(zones, list) else []:
            if not isinstance(zone, dict):
                continue
            profile = zone.get("profile")
            p = profile if isinstance(profile, dict) else {}
            warnings = [str(w) for w in zone.get("warnings", []) if isinstance(w, str)]
            awc = _num(p.get("awc_mm_per_m"))
            state = DataState.MEASURED
            if awc is None or awc <= 0:
                # Falling back keeps the twin runnable but the value is no longer a survey figure
                awc = 150.0
                state = DataState.ESTIMATED
                warnings.append("AWC missing in SSURGO: provisional 150 mm/m used (ESTIMATED)")
            restrictive = _num(p.get("restrictive_depth_cm"))
            root_limit = restrictive / 100.0 if restrictive and restrictive > 0 else DEFAULT_ROOT_LIMIT_M
            if restrictive is None:
                warnings.append(
                    f"no restrictive layer reported: root limit {DEFAULT_ROOT_LIMIT_M} m assumed (DECLARED)"
                )
            water_table = _num(p.get("water_table_min_depth_cm"))
            if water_table is not None and water_table < SHALLOW_WATER_TABLE_CM:
                warnings.append(
                    f"seasonal water table from {water_table:.0f} cm: tile drainage assumed, no capillary rise modelled"
                )
            out[str(zone.get("zone_id"))] = SoilProfile(
                awc_mm_per_m=awc,
                root_depth_max_m=root_limit,
                texture=_str(p.get("texture")),
                drainage_class=_str(p.get("drainage_class")),
                hydrologic_group=_str(p.get("hydrologic_group")),
                map_unit_name=_str(p.get("map_unit_name")),
                component_name=_str(p.get("component_name")),
                provenance=base.model_copy(update={"data_state": state}),
                verified=False,
                warnings=warnings,
            )
        if not out:
            raise DataNotFoundError(f"soil file for '{farm_id}' has no zones")
        return out
