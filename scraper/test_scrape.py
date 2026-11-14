"""python scraper/test_scrape.py  (o pytest)"""
from scrape import filename_for, find_links

HTML = """
<a href="/d/2023/datos.csv">a</a>
<a href="https://otro.mx/x.XLSX">b</a>
<a href="/d/2023/datos.csv">duplicado</a>
<a href="/acerca.html">no</a>
<a href="/descarga?id=7">api</a>
"""


def test_find_links():
    assert find_links(HTML, "https://sitio.mx/p/") == ["https://sitio.mx/d/2023/datos.csv", "https://otro.mx/x.XLSX"]
    assert find_links(HTML, "https://sitio.mx/", pattern=r"descarga\?id=") == ["https://sitio.mx/descarga?id=7"]


def test_filename_no_collision():
    a, b = filename_for("https://s.mx/2023/datos.csv"), filename_for("https://s.mx/2024/datos.csv")
    assert a != b and a.endswith("_datos.csv")
    assert filename_for("https://s.mx/datos%20agro.csv").endswith("_datos agro.csv")


if __name__ == "__main__":
    test_find_links()
    test_filename_no_collision()
    print("ok")
