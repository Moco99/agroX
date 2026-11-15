# Validacion EcoCrop

Datos sinteticos, no observaciones de campo ni probabilidades agronomicas calibradas.
El benchmark compara la API publica con una heuristica de estres sin ruido; el RF
aprende esa heuristica con ruido sintetico de desviacion 0.05. Ambos conjuntos
son independientes del entrenamiento (semilla 42, 12,000 muestras).

Resultados antes: accuracy 78.53%, balanced accuracy 80.26%, recall moderado 59.02%.
Despues, mismo benchmark (semilla 20261115): 94.13%, 92.23%, 95.84%.
Otra semilla (20261116): 94.23%, 92.85%, 95.75%.
La segunda semilla confirma consistencia de la correccion bajo el mismo generador;
no demuestra generalizacion geografica o temporal. No se seleccionaron parametros
mediante iteraciones sobre esta segunda semilla.

Los SQLite guardan entradas, etiqueta heuristica y salida completa por caso.
El script reemplaza risk_cases en su base de salida al ejecutarse.

Desde la raiz:

```powershell
.\.venv\Scripts\python.exe backend/tests/validate_ecocrop.py
.\.venv\Scripts\python.exe backend/tests/validate_ecocrop.py --seed 20261116 --output-dir backend/validation/fresh_seed
.\.venv\Scripts\python.exe -B -m pytest -c backend/pyproject.toml backend/tests/unit/test_ecocrop_model.py backend/tests/unit/test_ecocrop_regressions.py --noconftest -p no:cacheprovider -q
```

## Cambios y limites

- Lluvia y deficit de entrenamiento derivados de la misma demanda.
- Dias extremos enteros y acotados por el ciclo; mayor cobertura de severidad.
- Clase publica por argmax; score de riesgo queda como indice separado.
- Respaldo analitico usa la misma formula y supuesto de ruido que entrenamiento.
- Se rechazan no finitos, ciclos/demanda no positivos y otros valores imposibles.
- Importancias del RF son globales; no explicaciones causales por parcela.
- Se mantiene la formula del oraculo para comparar versiones, sin reclamar validez fisica.

## Mejoras de robustez

Se reprodujeron 20 casos fallidos y se corrigieron. La suite focalizada ahora
incluye 38 pruebas (las 4 existentes y 34 de regresion/propiedades).

- Nombres vacios y coincidencias ambiguas no seleccionan la primera especie.
- Datos desconocidos de idoneidad incluyen `data_state=incomplete` y advertencias.
- Umbrales trapezoidales desordenados e infinitos se rechazan.
- Dias extremos y longitud de ciclo requieren valores enteros.
- El deficit usa la demanda real incluso cuando es menor que 1.
- Las probabilidades conservan precision para no contradecir la clase predicha.
- Normalizar pesos antes de sumarlos evita overflow con pesos de magnitud 1e308.
- La bonificacion de una leguminosa no revive idoneidad cero.

## Rotation Engine conectado al recomendador

`RotationEngine.recommend_top_rotations` usa `rotation.generate_candidates` para
explorar secuencias de 2 a 4 ciclos, en lugar de seis listas fijas. Acepta
`previous_crop` y `exclude_same_family`. Rechaza especies desconocidas y cantidades
invalidas. La cobertura se identifica como `Vicia sativa ssp. sativa` porque el
catalogo distingue dos subespecies.

La cache vive solamente durante la peticion. Cada cultivo tiene hasta tres
estados de precedente; para 7 especies son como maximo 21 inferencias en vez de
repetirlas en las 2,401 secuencias de cuatro ciclos. La prueba comprueba ese limite
y que una segunda peticion con otro clima no reutiliza sus resultados.

El recomendador conserva su indice EcoCrop y ajustes por familia/leguminosa.
El riesgo sintetico es auxiliar y no interviene en el ranking. El ranking
multicriterio de `rotation.py` sigue esperando indicadores suministrados; falta
conectarlo al balance diario del gemelo, calendarios y endpoint. Los avisos de
cada recomendacion exponen estas limitaciones y la reutilizacion del clima.

No usar umbrales de precipitacion EcoCrop como demanda hidrica del ciclo sin
verificar su periodo de referencia. Esa conversion del recomendador sigue siendo
un supuesto no validado y ahora aparece en su salida.

Los reportes originales conservan los resultados historicos; la nueva ejecucion
de robustez usa semilla 20261117 en `robustness/`, con hash del codigo evaluado.

Para el MVP se recomienda reglas explicitas + balance FAO-56 + ranking multicriterio.
Mantener RF como experimento hasta contar con etiquetas observadas, validacion por
region/anio y calibracion. No interpretar este benchmark como precision de cosecha.

## Resultado de robustez (semilla 20261117)

3,000 casos: accuracy 94.70%, balanced accuracy 93.14%, recall moderado 95.48%
y recall alto 88.32%. Supera los umbrales del prototipo. La semilla es distinta
a las anteriores, por lo que las diferencias de porcentaje no demuestran una
mejora de precision entre versiones. Las correcciones apuntan a consistencia,
validacion de entradas y funcionamiento de rotaciones.

Se ejecutaron las 38 pruebas focalizadas con `--noconftest` para aislar el motor:
el entorno local no contiene FastAPI, que importa el conftest general del backend.
No se ejecuto la suite completa de API/proveedores. Ruff y `git diff --check`
tambien pasaron para los archivos modificados.

## Ajuste con validacion cruzada

Se ejecuto una busqueda de 21 configuraciones con cinco folds agrupados, comparacion de generalizacion y tiempos. Ver [protocolo y resultados](cross_validation/README.md). La configuracion seleccionada ya alimenta al motor; la evidencia sigue siendo sintetica.
