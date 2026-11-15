"""Build derived/weather/power_daily_<site>.csv from the raw NASA POWER daily CSV.

Units are taken from the POWER header (verified 2026-11-14): temperatures C,
precipitation mm/day, RH %, shortwave MJ/m2/day, wind m/s at 2 m, GWET* 0-1.
Missing values (-999) become NaN and every row gets a `qa_flags` column so the
backend can expose data quality instead of silently repairing anything.
"""

from __future__ import annotations

import io

import numpy as np
import pandas as pd

from pipeline.common import (
    DERIVED_DIR,
    POWER_ELEVATION_M,
    POWER_LAT,
    POWER_LON,
    RAW_DIR,
    SITE_ID,
    register_artifact,
    relative_to_derived,
    sha256_of,
    write_json,
)

RAW_POWER = RAW_DIR / "power" / "power_daily.csv"
MISSING_SENTINEL = -999.0

# POWER column -> canonical WeatherDay field
COLUMN_MAP = {
    "T2M": "t_mean",
    "T2M_MAX": "t_max",
    "T2M_MIN": "t_min",
    "PRECTOTCORR": "precip",
    "RH2M": "rh_mean",
    "ALLSKY_SFC_SW_DWN": "solar_rad",
    "WS2M": "wind_2m",
    "GWETROOT": "gwet_root",
    "GWETTOP": "gwet_top",
    "FROST_DAYS": "frost_days",
}

# Flag thresholds are QA heuristics (product configuration, not science)
T_OUTLIER_DEGC = 12.0
PRECIP_EXTREME_MM = 150.0


# ─────────────────────────────────────────
# Section: Parsing
# ─────────────────────────────────────────


def read_power_csv(path: str | None = None) -> tuple[pd.DataFrame, str]:
    """Return (dataframe, header_text); the header is kept for provenance."""
    text = (RAW_POWER if path is None else RAW_DIR / path).read_text()
    header, body = text.split("-END HEADER-")
    df = pd.read_csv(io.StringIO(body.strip()))
    df["date"] = pd.to_datetime(df["YEAR"].astype(str) + df["DOY"].astype(str).str.zfill(3), format="%Y%j").dt.strftime(
        "%Y-%m-%d"
    )
    df = df.rename(columns=COLUMN_MAP)
    return df, header.strip()


# ─────────────────────────────────────────
# Section: Quality flags
# ─────────────────────────────────────────


def qa_flags(df: pd.DataFrame) -> tuple[pd.Series, dict[str, int]]:
    """Per-row flags joined by ';' plus a summary count per flag."""
    flags: list[list[str]] = [[] for _ in range(len(df))]
    numeric = [c for c in COLUMN_MAP.values()]
    missing_mask = (df[numeric] == MISSING_SENTINEL).any(axis=1)
    # Rolling median over 15 days catches isolated artefacts without hiding real cold snaps
    rolling = df["t_mean"].replace(MISSING_SENTINEL, np.nan).rolling(15, center=True, min_periods=5).median()
    outlier_mask = (df["t_mean"] - rolling).abs() > T_OUTLIER_DEGC
    tmax_lt_tmin = df["t_max"] < df["t_min"]
    precip_extreme = df["precip"] > PRECIP_EXTREME_MM
    precip_negative = (df["precip"] < 0) & (df["precip"] != MISSING_SENTINEL)
    for i in range(len(df)):
        if missing_mask.iat[i]:
            flags[i].append("missing")
        if bool(outlier_mask.iat[i]):
            flags[i].append("t_outlier")
        if bool(tmax_lt_tmin.iat[i]):
            flags[i].append("tmax_lt_tmin")
        if bool(precip_extreme.iat[i]):
            flags[i].append("precip_extreme")
        if bool(precip_negative.iat[i]):
            flags[i].append("precip_negative")
    summary = {
        "missing": int(missing_mask.sum()),
        "t_outlier": int(outlier_mask.sum()),
        "tmax_lt_tmin": int(tmax_lt_tmin.sum()),
        "precip_extreme": int(precip_extreme.sum()),
        "precip_negative": int(precip_negative.sum()),
    }
    return pd.Series([";".join(f) for f in flags]), summary


# ─────────────────────────────────────────
# Section: Build
# ─────────────────────────────────────────


def build() -> None:
    df, header = read_power_csv()
    flags, summary = qa_flags(df)
    df["qa_flags"] = flags
    cols = ["date", *COLUMN_MAP.values(), "qa_flags"]
    out = df[cols].copy()
    out[list(COLUMN_MAP.values())] = out[list(COLUMN_MAP.values())].replace(MISSING_SENTINEL, np.nan)

    out_dir = DERIVED_DIR / "weather"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"power_daily_{SITE_ID}.csv"
    out.to_csv(csv_path, index=False, float_format="%.3f")

    monthly = (
        out.assign(month=out["date"].str[:7])
        .groupby("month")[["t_mean", "t_max", "t_min", "precip"]]
        .agg({"t_mean": "mean", "t_max": "mean", "t_min": "mean", "precip": "sum"})
        .round(2)
    )
    meta = {
        "artifact_id": "weather_power_daily",
        "source": "NASA POWER (MERRA-2 / CERES SYN1deg), daily, point request",
        "source_id": "power",
        "location": {"lat": POWER_LAT, "lon": POWER_LON, "elevation_m": POWER_ELEVATION_M},
        "resolution": "0.5 x 0.625 degree cell (MERRA-2); not an in-situ station",
        "period": {"start": out["date"].iloc[0], "end": out["date"].iloc[-1], "days": int(len(out))},
        "units": {
            "t_mean": "C",
            "t_max": "C",
            "t_min": "C",
            "precip": "mm/day",
            "rh_mean": "%",
            "solar_rad": "MJ/m2/day",
            "wind_2m": "m/s",
            "gwet_root": "index 0-1",
            "gwet_top": "index 0-1",
            "frost_days": "days (0/1)",
        },
        "data_state": "MEASURED",
        "method": "Header stripped; -999 -> NaN; QA flags per row (missing, t_outlier vs 15-day rolling "
        "median > 12 C, tmax_lt_tmin, precip_extreme > 150 mm, precip_negative).",
        "qa_summary": summary,
        "qa_note": (
            "Full-file check 2026-11-14: no -999 and no t_max < t_min; monthly means for May-Aug 2023 "
            "(18-25 C) are consistent with central Iowa climatology, so the suspected summer cold artefact "
            "was not confirmed. t_outlier is a heuristic flag (|t_mean - 15-day rolling median| > 12 C) and "
            "can mark genuine cold snaps; flagged days are kept unchanged and exposed as warnings."
        ),
        "flagged_days": {
            flag: out.loc[out["qa_flags"].str.contains(flag), "date"].tolist() for flag in summary if summary[flag] > 0
        },
        "monthly_summary": {k: v for k, v in monthly.to_dict(orient="index").items()},
        "raw_header": header,
        "inputs": [{"path": "data/raw/power/power_daily.csv", "sha256": sha256_of(RAW_POWER)}],
    }
    meta_path = out_dir / f"power_daily_{SITE_ID}.meta.json"
    write_json(meta_path, meta)
    register_artifact(
        "weather_power_daily",
        {
            "files": [relative_to_derived(csv_path), relative_to_derived(meta_path)],
            "data_state": "MEASURED",
            "source_id": "power",
            "period": meta["period"],
            "qa_summary": summary,
        },
    )
    print(f"[weather] {len(out)} days -> {csv_path.name}; qa={summary}")


if __name__ == "__main__":
    build()
