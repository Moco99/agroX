"""python scraper/test_punto.py  (o pytest). Prueba las partes de cálculo sin red."""
from punto import _validar, ndvi, pendiente, promedio_por_fecha


def test_ndvi():
    assert ndvi(1000, 3000, 4) == 0.5          # vegetación (SCL 4)
    assert ndvi(1000, 3000, 9) is None         # nube alta
    assert ndvi(1000, 3000, 3) is None         # sombra de nube
    assert ndvi(0, 0, 4) is None               # sin reflectancia


def test_pendiente():
    assert pendiente(100, 100, 100, 100, 30) == 0.0
    assert pendiente(100, 100, 130, 70, 30) == 45.0   # sube 60 m en 60 m de este a oeste


def test_promedio_por_fecha():
    serie = promedio_por_fecha([("2024-06-02", 0.6), ("2024-06-01", 0.2), ("2024-06-02", 0.8)])
    assert serie == [{"fecha": "2024-06-01", "ndvi": 0.2}, {"fecha": "2024-06-02", "ndvi": 0.7}]


def test_validar():
    _validar(30.8, 75.55, "2023-01-01", "2024-12-31")
    for args in [(91, 0, "2023-01-01", "2024-01-01"), (0, 181, "2023-01-01", "2024-01-01"), (0, 0, "2024-01-01", "2023-01-01")]:
        try:
            _validar(*args)
        except ValueError:
            continue
        raise AssertionError(f"debió fallar: {args}")


if __name__ == "__main__":
    test_ndvi(); test_pendiente(); test_promedio_por_fecha(); test_validar()
    print("ok")
