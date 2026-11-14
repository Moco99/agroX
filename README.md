# agroX

## Scraper de datos

```bash
pip install -r requirements.txt
python scraper/scrape.py              # todas las fuentes habilitadas
python scraper/scrape.py siap inegi   # solo algunas
```

Los archivos quedan en `data/raw/<id>/` y cada descarga se anota en `data/manifest.csv`
(fuente, URL, ruta, sha256, tamaño, fecha). `data/` no se sube a git.
Si se vuelve a correr, salta lo que ya se bajó.

### Agregar un sitio

1. Agrega un bloque a `scraper/sources.json`:
   ```json
   {"id": "siap", "url": "https://.../datos-abiertos"}
   ```
   Por defecto baja todos los links a `.csv .xlsx .xls .json .zip .xml .geojson .parquet .txt`.
   Opcional: `"pattern"` (regex sobre la URL) o `"exts"` para cambiar el filtro, y `"enabled": false` para pausarlo.
2. Si el sitio usa una API, paginación o JavaScript, copia `scraper/sites/_plantilla.py`
   como `scraper/sites/<id>.py` y haz que `links()` devuelva las URLs a bajar.

Para repartir los 28 sitios: cada quien trabaja en su archivo `sites/<id>.py` y su bloque en `sources.json`.

Pruebas: `python scraper/test_scrape.py`
