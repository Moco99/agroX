# Gemelo Virtual para agroX

Este directorio deja una base útil para usar el repositorio como punto de partida de un hackathon centrado en un "gemelo virtual" agrícola.

## Objetivo

Usar los datos climáticos, de suelo, cultivos y satélites ya integrados en agroX para construir una vista operativa del campo o de la región:

- clima y lluvia
- humedad del suelo
- cobertura del suelo y cultivos
- elevación y condiciones del terreno
- métricas históricas y tendencias

## Flujo recomendado

1. Definir el área y el rango de fechas en `scraper/sources.json`.
2. Descargar las fuentes clave para la zona objetivo.
3. Normalizar y combinar los datasets por fecha y ubicación.
4. Crear una capa analítica para el digital twin: riesgo, productividad, humedad, estrés hídrico, etc.
5. Exponer el resultado en una vista simple (dashboard, mapa, notebook o API ligera).

## Inicio rápido

Desde la raíz del repositorio:

```bash
python3 -m pip install -r requirements.txt
python3 hackathon/quickstart.py power cdl prism
```

Esto ejecuta una descarga mínima para pruebas rápidas de la zona configurada en el proyecto.

## Ideas de uso para el hackathon

- Predicción de riesgo de sequía o estrés en cultivos.
- Comparación entre tipo de suelo y productividad histórica.
- Visualización de una zona agrícola como gemelo digital con capas temporales.
- Alertas por cambios de cobertura o condiciones climáticas severas.
- Monitoreo de rendimiento por parcelería o región.

## Estructura de trabajo sugerida

- Datos crudos: `data/raw/`
- Manifest: `data/manifest.csv`
- Filtros y limpieza: preparar un módulo nuevo para ETL local.
- Analítica: crear un notebook o pipeline de agregación.
- Visualización: mapa + métricas por región.

## Recomendación

Usa una zona pequeña y una fecha acotada en la config para poder iterar rápido durante el hackathon.
