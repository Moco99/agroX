"""Parameters of the synthetic generators: synthetic, NOT scientific.

Orders of magnitude loosely inspired by a northern mid-latitude summer climate so the
twin produces readable curves. Nothing here is presented as data about any real place.
"""

from __future__ import annotations

from datetime import date

GENERATOR_VERSION = "v1"

# ─────────────────────────────────────────
# Section: Coverage and location
# ─────────────────────────────────────────

# Ten synthetic years let the climate endpoint compute an anomaly against a (synthetic) reference
START = date(2015, 1, 1)
END = date(2024, 12, 31)
LAT = 41.995
LON = -93.49
ELEVATION_M = 300.0

# ─────────────────────────────────────────
# Section: Weather
# ─────────────────────────────────────────

T_MEAN_ANNUAL = 9.5
T_AMPLITUDE = 15.5
# Seasonal cycle peaks mid-July (day ~200) to mimic a northern mid-latitude summer
T_PEAK_DOY = 200
T_NOISE_SD = 2.2
T_AR1 = 0.7
DIURNAL_RANGE_MEAN = 11.0
DIURNAL_RANGE_SD = 2.0

# Two-state Markov chain for rain occurrence, gamma amounts
P_WET_AFTER_DRY = 0.25
P_WET_AFTER_WET = 0.50
RAIN_GAMMA_SHAPE = 0.75
RAIN_GAMMA_SCALE_SUMMER = 12.0
RAIN_GAMMA_SCALE_WINTER = 5.0

RH_MEAN = 72.0
RH_AMPLITUDE = 6.0
RH_SD = 8.0
SOLAR_MEAN = 15.0
SOLAR_AMPLITUDE = 9.0
SOLAR_SD = 3.5
WIND_MEAN = 3.5
WIND_SD = 1.0

# ─────────────────────────────────────────
# Section: Soil (plausible loam)
# ─────────────────────────────────────────

SOIL_AWC_MM_PER_M = 160.0
SOIL_ROOT_LIMIT_M = 1.5
SOIL_TEXTURE = "L"
SOIL_DRAINAGE = "Moderately well drained"
SOIL_HYDGRP = "B"

# ─────────────────────────────────────────
# Section: Farm layout (2 x 2 zones of 600 m)
# ─────────────────────────────────────────

ZONE_SIZE_DEG_LAT = 0.0054
ZONE_SIZE_DEG_LON = 0.0072
ZONES: list[tuple[str, str, str, int, int]] = [
    # zone_id, name, crop 2024, row, col
    ("zone_nw", "Zona Noroeste (sintética)", "corn", 0, 0),
    ("zone_ne", "Zona Noreste (sintética)", "soybean", 0, 1),
    ("zone_sw", "Zona Suroeste (sintética)", "soybean", 1, 0),
    ("zone_se", "Zona Sureste (sintética)", "corn", 1, 1),
]

# ─────────────────────────────────────────
# Section: Observations
# ─────────────────────────────────────────

NDVI_BARE = 0.22
NDVI_PEAK = {"corn": 0.86, "soybean": 0.88}
# Double logistic: green-up and senescence day-of-year centres and slopes
NDVI_GREENUP_DOY = {"corn": 175, "soybean": 185}
NDVI_SENESCENCE_DOY = {"corn": 262, "soybean": 258}
NDVI_SLOPE = 0.12
NDVI_NOISE_SD = 0.025
CLOUD_GAP_PROBABILITY = 0.2
SMAP_MEAN = 0.24
SMAP_SD = 0.05
