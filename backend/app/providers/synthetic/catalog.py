"""SyntheticCropCatalogProvider: complete, provisional parameter sets (no nulls), labelled SYNTHETIC."""

from __future__ import annotations

from app.providers.synthetic import params as P
from app.providers.synthetic import source
from app.schemas.common import CropType, DataState, Provenance
from app.schemas.crops import CropCatalog, CropParams, GddStages, PlantingWindow, StageLengthsDays


def _crop(
    crop_id: str,
    names: tuple[str, str, str],
    crop_type: CropType,
    fixes_n: bool,
    window: tuple[str, str],
    temps: tuple[float, float, float, float, float | None],
    gdd: tuple[float, float, float, float],
    lengths: tuple[int, int, int, int],
    kc: tuple[float, float, float],
    roots: tuple[float, float],
    p: float,
) -> CropParams:
    return CropParams(
        crop_id=crop_id,
        name_es=names[0],
        name_en=names[1],
        family=names[2],
        crop_type=crop_type,
        fixes_nitrogen=fixes_n,
        cycle_days=sum(lengths),
        planting_window=PlantingWindow(start_mmdd=window[0], end_mmdd=window[1]),
        t_min=temps[0],
        t_opt=temps[1],
        t_max=temps[2],
        t_base_gdd=temps[3],
        t_cap_gdd=temps[4],
        gdd_stages=GddStages(initial=0.0, development=gdd[0], mid=gdd[1], late=gdd[2], maturity=gdd[3]),
        stage_lengths_days=StageLengthsDays(
            initial=lengths[0], development=lengths[1], mid=lengths[2], late=lengths[3]
        ),
        kc_ini=kc[0],
        kc_mid=kc[1],
        kc_end=kc[2],
        root_depth_min_m=roots[0],
        root_depth_max_m=roots[1],
        depletion_fraction_p=p,
        sources=["synthetic generator (not scientific)"],
        verified=False,
    )


class SyntheticCropCatalogProvider:
    def get_catalog(self) -> CropCatalog:
        crops = [
            _crop(
                "corn",
                ("Maíz", "Corn", "Poaceae"),
                CropType.CASH_CROP,
                False,
                ("04-20", "05-25"),
                (10.0, 25.0, 35.0, 10.0, 30.0),
                (200.0, 650.0, 1150.0, 1450.0),
                (30, 40, 50, 30),
                (0.3, 1.2, 0.6),
                (0.2, 1.2),
                0.55,
            ),
            _crop(
                "soybean",
                ("Soya", "Soybean", "Fabaceae"),
                CropType.CASH_CROP,
                True,
                ("05-01", "06-05"),
                (10.0, 26.0, 35.0, 10.0, 30.0),
                (150.0, 550.0, 1050.0, 1300.0),
                (20, 30, 60, 25),
                (0.4, 1.15, 0.5),
                (0.2, 1.0),
                0.5,
            ),
            _crop(
                "cereal_rye",
                ("Centeno de cobertura", "Cereal rye (cover)", "Poaceae"),
                CropType.COVER_CROP,
                False,
                ("09-15", "10-31"),
                (0.0, 20.0, 32.0, 0.0, None),
                (300.0, 900.0, 1400.0, 1700.0),
                (30, 90, 60, 30),
                (0.3, 1.1, 0.3),
                (0.15, 1.0),
                0.55,
            ),
        ]
        return CropCatalog(
            catalog_version="catalog_v1",
            crops=crops,
            provenance=Provenance(
                source=source("catalog"), data_state=DataState.SYNTHETIC, version=P.GENERATOR_VERSION
            ),
            notes=["synthetic catalog: parameters are placeholders for tests, not agronomic values"],
        )
