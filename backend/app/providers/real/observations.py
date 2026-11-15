"""RealObservationProvider: MODIS / Sentinel-2 NDVI per zone, SMAP surface moisture, S2 overlay PNG."""

from __future__ import annotations

import base64
import csv
from datetime import date
from pathlib import Path

from app.providers.ports import DataNotFoundError
from app.providers.real import manifest_entry, provenance_from_manifest, read_json
from app.schemas.common import DataState
from app.schemas.observations import NdviOverlay, ObservationPoint, ObservationSeries, ObservationVariable

# Mirror of docs/07-design/design-tokens.md NDVI ramp (also used by the pipeline to colour the PNG)
NDVI_LEGEND: list[dict[str, float | str]] = [
    {"value": 0.20, "color": "#DC342E"},
    {"value": 0.35, "color": "#F19728"},
    {"value": 0.50, "color": "#F0E533"},
    {"value": 0.65, "color": "#6FBE30"},
    {"value": 0.80, "color": "#319D34"},
]

NDVI_SOURCES: dict[str, tuple[str, str, float]] = {
    # source_id: (manifest artifact, csv name template, nominal resolution in m)
    "modis_ndvi": ("obs_ndvi_modis", "ndvi_modis_{farm}.csv", 250.0),
    "sentinel2": ("obs_ndvi_sentinel2", "ndvi_s2_{farm}.csv", 10.0),
}


def _read_rows(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


class RealObservationProvider:
    def __init__(self, derived_dir: Path) -> None:
        self._dir = derived_dir
        self._obs = derived_dir / "obs"

    def ndvi_sources(self) -> list[str]:
        return list(NDVI_SOURCES)

    def ndvi_series(self, farm_id: str, source_id: str) -> ObservationSeries:
        if source_id not in NDVI_SOURCES:
            raise DataNotFoundError(f"unknown NDVI source '{source_id}'")
        artifact, template, resolution = NDVI_SOURCES[source_id]
        path = self._obs / template.format(farm=farm_id)
        if not path.exists():
            raise DataNotFoundError(f"no {source_id} NDVI for farm '{farm_id}'")
        points: list[ObservationPoint] = []
        for row in _read_rows(path):
            if not row.get("ndvi"):
                continue
            points.append(
                ObservationPoint(
                    date=date.fromisoformat(row["date"]),
                    variable=ObservationVariable.NDVI,
                    value=float(row["ndvi"]),
                    zone_id=row.get("zone_id") or None,
                    n_pixels=int(row["n_pixels"]) if row.get("n_pixels") else None,
                    qa_flag=row.get("qa_flag") or None,
                    p10=float(row["ndvi_p10"]) if row.get("ndvi_p10") else None,
                    p90=float(row["ndvi_p90"]) if row.get("ndvi_p90") else None,
                    valid_fraction=float(row["valid_fraction"]) if row.get("valid_fraction") else None,
                )
            )
        entry = manifest_entry(self._dir, artifact)
        warnings: list[str] = []
        if source_id == "modis_ndvi":
            warnings.append("MODIS 250 m: 1-2 pixels per 36 ha zone, no pixel-reliability layer (qa_flag=no_qa_layer)")
        note = entry.get("coverage_note")
        if isinstance(note, str):
            warnings.append(note)
        return ObservationSeries(
            variable=ObservationVariable.NDVI,
            source_id=source_id,
            resolution_m=resolution,
            points=sorted(points, key=lambda p: (p.date, p.zone_id or "")),
            provenance=provenance_from_manifest(self._dir, artifact, source_id, DataState.MEASURED),
            warnings=warnings,
        )

    def soil_moisture(self, farm_id: str) -> ObservationSeries:
        path = self._obs / "smap_story_pilot.csv"
        if not path.exists() or farm_id not in self._farms():
            raise DataNotFoundError(f"no SMAP series for farm '{farm_id}'")
        points: list[ObservationPoint] = []
        for row in _read_rows(path):
            if not row.get("soil_moisture"):
                continue
            points.append(
                ObservationPoint(
                    date=date.fromisoformat(row["date"]),
                    variable=ObservationVariable.SOIL_MOISTURE,
                    value=float(row["soil_moisture"]),
                    qa_flag=row.get("qual_flag") or None,
                )
            )
        # SPL3SMP_E retrieval_qual_flag bit 0 set = "recommended quality not achieved"
        flagged = sum(1 for p in points if p.qa_flag and p.qa_flag.isdigit() and int(p.qa_flag) & 1)
        warnings = ["SMAP 9 km / ~5 cm surface layer: regional context, not a field sensor"]
        if flagged:
            warnings.append(
                f"{flagged}/{len(points)} retrievals carry SMAP quality bit 0 (not recommended quality, typical over "
                "dense crops); kept for context, never used to drive the twin"
            )
        return ObservationSeries(
            variable=ObservationVariable.SOIL_MOISTURE,
            source_id="smap",
            resolution_m=9000.0,
            points=points,
            provenance=provenance_from_manifest(self._dir, "obs_smap", "SMAP SPL3SMP_E", DataState.MEASURED),
            warnings=warnings,
        )

    def _farms(self) -> set[str]:
        folder = self._dir / "parcel"
        return {p.name.removesuffix(".geojson") for p in folder.glob("*.geojson")} if folder.exists() else set()

    def ndvi_overlay(self, farm_id: str) -> NdviOverlay | None:
        png = self._obs / f"ndvi_s2_overlay_{farm_id}.png"
        meta_path = self._obs / f"ndvi_s2_overlay_{farm_id}.json"
        if not png.exists() or not meta_path.exists():
            return None
        meta = read_json(meta_path)
        bounds_raw = meta.get("bounds")
        bounds = {k: float(v) for k, v in bounds_raw.items()} if isinstance(bounds_raw, dict) else {}
        return NdviOverlay(
            farm_id=farm_id,
            date=date.fromisoformat(str(meta["date"])),
            source=str(meta.get("source", "Sentinel-2 L2A")),
            resolution_m=float(str(meta.get("resolution_m", 10))),
            bounds=bounds,
            width_px=int(str(meta.get("width_px", 0))),
            height_px=int(str(meta.get("height_px", 0))),
            png_base64=base64.b64encode(png.read_bytes()).decode("ascii"),
            data_state=DataState.MEASURED,
            legend_stops=NDVI_LEGEND,
            warnings=["grey pixels = masked by SCL (cloud/shadow/other) or outside the scene"],
        )
