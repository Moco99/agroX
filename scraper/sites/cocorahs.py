"""CoCoRaHS: lluvia diaria de estaciones voluntarias en todo el estado, un CSV por año (~12 MB/año en Iowa). Sin llave."""


def _us(d):  # "2024-03-05" -> "3/5/2024"
    return f"{int(d[5:7])}/{int(d[8:10])}/{d[:4]}"


def links(session, src):
    a = src["area"]
    y0, y1 = int(a["start"][:4]), int(a["end"][:4])
    out = []
    for y in range(y0, y1 + 1):
        start = a["start"] if y == y0 else f"{y}-01-01"
        end = a["end"] if y == y1 else f"{y}-12-31"
        out.append({"url": "https://data.cocorahs.org/export/exportreports.aspx", "name": f"cocorahs_{a['state']}_{y}.csv",
                    "params": {"ReportType": "Daily", "dtf": 1, "Format": "CSV", "State": a["state"],
                               "ReportDateType": "reportdate", "StartDate": _us(start), "EndDate": _us(end), "TimesInGMT": "False"}})
    return out
