"""NASA POWER: clima diario para agricultura en el centro del área. Sin llave. https://power.larc.nasa.gov/docs/"""
from common import center

PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,WS2M,GWETROOT,GWETTOP,FROST_DAYS"


def links(session, src):
    a = src["area"]
    lon, lat = center(a)
    return [{"url": "https://power.larc.nasa.gov/api/temporal/daily/point", "name": "power_daily.csv",
             "params": {"parameters": PARAMS, "community": "AG", "longitude": round(lon, 4), "latitude": round(lat, 4),
                        "start": a["start"].replace("-", ""), "end": a["end"].replace("-", ""), "format": "CSV"}}]
