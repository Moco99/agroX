"""LiveSoilProvider: SSURGO where it exists, SoilGrids 2.0 (ISRIC, 250 m) everywhere else.

The water balance needs available water capacity (AWC). SoilGrids publishes volumetric water content at
field capacity (wv0033, -33 kPa) and wilting point (wv1500, -1500 kPa); AWC is their difference averaged
over 0-100 cm, so no pedotransfer coefficients are invented. In the US pilot SSURGO (field scale) stays the
source and SoilGrids is reported as a cross-check; elsewhere SoilGrids feeds the twin as ESTIMATED.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date
from pathlib import Path

from app.providers.live.parcel import cached, centroid, zone_rings
from app.providers.ports import DataNotFoundError
from app.providers.real.soil import DEFAULT_ROOT_LIMIT_M, RealSoilProvider
from app.schemas.common import DataState, Provenance
from app.schemas.soil import SoilProfile

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
# SoilGrids standard depth intervals down to 1 m, with their thickness in cm for the weighted mean
DEPTHS_CM = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15, "30-60cm": 30, "60-100cm": 40}

SoilJson = dict[str, object]
Fetcher = Callable[[float, float], SoilJson]


def fetch_soilgrids(lon: float, lat: float) -> SoilJson:
    params = [("lon", lon), ("lat", lat), ("value", "mean"), ("property", "wv0033"), ("property", "wv1500")]
    params += [("depth", d) for d in DEPTHS_CM]
    url = f"{SOILGRIDS_URL}?{urllib.parse.urlencode(params)}"
    # Short timeout: SoilGrids is slow and rate-limited; the twin must not wait on a cross-check
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "agrox-backend"}), timeout=20) as r:
        data = json.loads(r.read())
    if not isinstance(data, dict):
        raise ValueError("SoilGrids: unexpected response")
    return data


def awc_mm_per_m(data: SoilJson) -> float | None:
    """Depth-weighted (wv0033 - wv1500) over 0-100 cm, in mm of water per m of soil; None if any depth is missing."""
    props = data["properties"]
    assert isinstance(props, dict)
    layers = {lay["name"]: lay for lay in props["layers"]}
    total = 0.0
    for label, thickness in DEPTHS_CM.items():
        vals = []
        for name in ("wv0033", "wv1500"):
            lay = layers[name]
            depth = next(d for d in lay["depths"] if d["label"] == label)
            mean = depth["values"]["mean"]
            if mean is None:
                return None
            # d_factor turns the stored integer into 10^-2 cm3/cm3 (volume %)
            vals.append(mean / lay["unit_measure"]["d_factor"])
        # volume % difference * 10 = mm of water per m of soil
        total += (vals[0] - vals[1]) * 10 * thickness
    return round(total / sum(DEPTHS_CM.values()), 1)


class LiveSoilProvider(RealSoilProvider):
    def __init__(
        self,
        derived_dir: Path,
        cache_dir: Path,
        fetcher: Fetcher = fetch_soilgrids,
        today: Callable[[], date] = date.today,
    ) -> None:
        super().__init__(derived_dir)
        self._cache_dir = cache_dir
        self._fetcher, self._today = fetcher, today

    def _soilgrids_awc(self, farm_id: str) -> dict[str, float | None]:
        rings = zone_rings(self._dir, farm_id)

        def build() -> dict[str, float | None]:
            # One request per farm: zones are ~600 m apart and SoilGrids cells are 250 m, while ISRIC asks for
            # about 5 calls per minute, so per-zone requests would mostly hit the rate limit
            pts = [centroid(r) for r in rings.values()]
            lon, lat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            awc = awc_mm_per_m(self._fetcher(lon, lat))
            return {z: awc for z in rings}

        return cached(self._cache_dir, f"soilgrids_awc_{farm_id}", build, self._today())

    def get_zone_soils(self, farm_id: str) -> dict[str, SoilProfile]:
        try:
            ssurgo = super().get_zone_soils(farm_id)
        except DataNotFoundError:
            ssurgo = {}
        try:
            grids = self._soilgrids_awc(farm_id)
        except Exception as exc:
            if not ssurgo:
                raise
            note = f"SoilGrids cross-check unavailable ({type(exc).__name__})"
            return {z: p.model_copy(update={"warnings": [*p.warnings, note]}) for z, p in ssurgo.items()}
        out: dict[str, SoilProfile] = {}
        for zid in sorted(set(ssurgo) | set(grids)):
            g = grids.get(zid)
            if zid in ssurgo:
                p = ssurgo[zid]
                if g:
                    check = f"SoilGrids 250 m cross-check: AWC {g} mm/m vs SSURGO {p.awc_mm_per_m}"
                    p = p.model_copy(update={"warnings": [*p.warnings, check]})
                out[zid] = p
            elif g:
                out[zid] = SoilProfile(
                    awc_mm_per_m=g,
                    root_depth_max_m=DEFAULT_ROOT_LIMIT_M,
                    provenance=Provenance(
                        source="SoilGrids 2.0 (ISRIC) wv0033 - wv1500, 0-100 cm",
                        data_state=DataState.ESTIMATED,
                        resolution="250 m",
                        method="depth-weighted water content difference at -33 and -1500 kPa",
                    ),
                    warnings=[
                        "SoilGrids is a 250 m model prediction (ESTIMATED), not a field survey",
                        f"no restrictive layer data: root limit {DEFAULT_ROOT_LIMIT_M} m assumed (DECLARED)",
                    ],
                )
        if not out:
            raise DataNotFoundError(f"no soil data for farm '{farm_id}'")
        return out
