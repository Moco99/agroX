"""RealCropCatalogProvider: catalog_v1 built from literature values (all verified=false)."""

from __future__ import annotations

from pathlib import Path

from app.providers.ports import DataNotFoundError
from app.providers.real import read_json
from app.schemas.common import DataState, Provenance
from app.schemas.crops import CropCatalog, CropParams

CATALOG_FILE = Path("catalog") / "catalog_v1.json"


class RealCropCatalogProvider:
    def __init__(self, derived_dir: Path) -> None:
        self._path = derived_dir / CATALOG_FILE

    def get_catalog(self) -> CropCatalog:
        if not self._path.exists():
            raise DataNotFoundError("crop catalog missing: run `make derived`")
        doc = read_json(self._path)
        crops_raw = doc.get("crops")
        crops = [CropParams.model_validate(c) for c in (crops_raw if isinstance(crops_raw, list) else [])]
        notes_raw = doc.get("notes")
        notes = [str(n) for n in notes_raw] if isinstance(notes_raw, list) else []
        # Literature values never count as measured: ESTIMATED until an agronomist verifies them
        return CropCatalog(
            catalog_version=str(doc.get("catalog_version", "catalog_v1")),
            crops=crops,
            provenance=Provenance(
                source="literature (FAO-56 + extension conventions, to verify)",
                data_state=DataState.ESTIMATED,
                version=str(doc.get("catalog_version", "catalog_v1")),
            ),
            notes=notes,
        )
