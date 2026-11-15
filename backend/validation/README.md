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
.\.venv\Scripts\python.exe -B -m pytest backend/validation/test_risk_regressions.py --confcutdir=backend/validation -p no:cacheprovider -q
```

## Cambios y limites

- Lluvia y deficit de entrenamiento derivados de la misma demanda.
- Dias extremos enteros y acotados por el ciclo; mayor cobertura de severidad.
- Clase publica por argmax; score de riesgo queda como indice separado.
- Respaldo analitico usa la misma formula y supuesto de ruido que entrenamiento.
- Se rechazan no finitos, ciclos/demanda no positivos y otros valores imposibles.
- Importancias del RF son globales; no explicaciones causales por parcela.
- Se mantiene la formula del oraculo para comparar versiones, sin reclamar validez fisica.

## Inicio del Rotation Engine

`backend/app/engine/rotation.py` contiene generacion de candidatos e historial,
filtro opcional de familias y ranking de indicadores suministrados. No esta
conectado al endpoint ni al recomendador anterior. No comprueba calendarios.
El siguiente paso es conectar indicadores diarios del gemelo y catalogo verificado.
No usar umbrales de precipitacion EcoCrop como demanda hidrica del ciclo sin
verificar su periodo de referencia. El recomendador anterior aun lo hace.

Para el MVP se recomienda reglas explicitas + balance FAO-56 + ranking multicriterio.
Mantener RF como experimento hasta contar con etiquetas observadas, validacion por
region/anio y calibracion. No interpretar este benchmark como precision de cosecha.
