# Validacion cruzada y ajuste de EcoCrop-RF

Resultado reproducible del ajuste solicitado. Datos exclusivamente sinteticos; no valida cosechas ni riesgos de campo.

## Protocolo

- Desarrollo: 12,000 muestras, semilla 42, 30 perfiles de duracion/demanda.
- Cinco particiones StratifiedGroupKFold: ningun perfil se comparte entre entrenamiento y validacion de una particion.
- 20 configuraciones muestreadas reproduciblemente mas el modelo anterior: 105 ajustes de CV, luego refit final.
- Se selecciona por F1 macro con regla de un error estandar, limites frente al recall alto y balanced accuracy del baseline, tolerancia de log-loss y menor complejidad entre opciones equivalentes.
- Seleccion y configuracion escritas antes de construir los holdouts. Los holdouts no participan en el ajuste.
- Cuatro muestras finales de 3,000 casos: IID, perfiles de duracion/demanda nuevos, sequia desplazada y condiciones muy humedas.
- Los perfiles son sinteticos, no parcelas o regiones reales. En IID los perfiles se repiten, pero las filas y semillas son nuevas.

## Resultado de CV

| Metrica (media de cinco folds) | Anterior | Elegido |
|---|---:|---:|
| F1 macro | 0.8489 | 0.8551 |
| Balanced accuracy | 0.8344 | 0.8473 |
| Recall alto | 0.7325 | 0.7749 |
| Log-loss (menor es mejor) | 0.3182 | 0.3004 |
| Brecha F1 entrenamiento-validacion | 0.1017 | 0.0535 |

La desviacion entre folds de F1 macro fue 0.0074 antes y 0.0077 despues. Los scores de CV se usaron para ajustar y no son una estimacion imparcial final.

Configuracion elegida:

```json
{
  "class_weight": null,
  "max_depth": 10,
  "max_features": 1.0,
  "max_samples": 1.0,
  "min_samples_leaf": 8,
  "n_estimators": 240
}
```

## Accuracy sobre etiquetas sinteticas con ruido

| Muestra reservada | Anterior | Elegido | IC 95% del cambio, puntos porcentuales |
|---|---:|---:|---|
| iid | 88.03% | 88.43% | [-0.23, 1.07] |
| unseen_profiles | 86.47% | 87.00% | [-0.17, 1.23] |
| shifted_drought | 82.27% | 83.57% | [0.57, 2.10] |
| shifted_wet | 98.77% | 98.80% | [-0.17, 0.23] |

Solo el cambio de accuracy en sequia tiene un intervalo pareado que excluye cero. No se afirma mejora estadisticamente concluyente en las otras muestras. Intervalos bootstrap de 2,000 remuestreos, condicionales a este generador sintetico.

En perfiles nuevos el recall alto subio de 71.83% a 77.71%. En el caso muy humedo, F1 macro bajo de 0.7890 a 0.7827 a pesar de la pequena subida de accuracy; no hay muestras de clase ALTO en ese escenario. Los soportes y matrices completos estan en report.json.

Tambien se evalua la formula sin ruido (`noiseless_oracle`). En perfiles nuevos su accuracy bajo de 95.43% a 95.10%. No se ocultaron regresiones ni se reajusto el modelo a partir de estos resultados.

Las accuracies de 94-95% de reportes anteriores correspondian a la formula sin ruido. Aqui el resultado principal usa etiquetas con ruido gaussiano de sigma 0.05, como el entrenamiento; no son porcentajes directamente comparables.

## Coste y uso en el motor

La inferencia individual `predict_proba` paso de unos 6.7 ms a 13.0 ms en esta maquina. El batch de 3,000 filas paso de unos 40.6 ms a 63.5 ms. Son tiempos medianos tras calentamiento; no incluyen entrenamiento, API o I/O. Se gana deteccion de riesgo y log-loss con mayor latencia, no velocidad.

El modelo lee la configuracion congelada `backend/app/engine/risk_model_config.json`; no realiza busquedas al iniciar. Sigue entrenando con las 12,000 muestras sinteticas. La salida incluye procedencia del entrenamiento y nombres de variables fuera de los rangos vistos. El aviso por rangos no es un detector completo de cambios conjuntos de distribucion.

## Reproducir

Desde la raiz:

```powershell
.\.venv\Scripts\python.exe backend/scripts/tune_ecocrop.py --candidates 20 --jobs 3
```

Agregar `--apply` reemplaza la configuracion del motor. Sin esa opcion solo guarda resultados. Repetir con estas semillas reproduce el experimento; si se usan los resultados para cambiar el espacio o la seleccion, los holdouts dejan de ser prueba final y se deben reservar nuevas semillas/distribuciones.

Para las pruebas focalizadas:

```powershell
.\.venv\Scripts\python.exe -B -m pytest -c backend/pyproject.toml backend/tests/unit/test_ecocrop_model.py backend/tests/unit/test_ecocrop_regressions.py backend/tests/unit/test_ecocrop_training.py --noconftest -p no:cacheprovider -q
```

## Artefactos y limites

- `report.json`: CV, matrices, soportes, metricas, tiempos, auditoria de folds e intervalos.
- `cv_candidates.json`: scores de entrenamiento/validacion de cada candidato y particion.
- `selected_config.json`: seleccion congelada antes de abrir los holdouts.
- `holdouts.sqlite`: 12,000 filas con entradas, etiquetas y probabilidades de ambos modelos.

El pipeline usa la misma regla causal sintetica en todos los escenarios; no hay rendimientos medidos. Temperatura y pH no son causales en esa regla; EcoCrop evalua la idoneidad aparte. El escenario humedo no modela anegamiento. Con datos reales, el siguiente paso es separar por parcela/region y anio, verificar unidades hidricas y calibrar probabilidades con resultados observados.

Referencias: [CV agrupada](https://scikit-learn.org/stable/modules/cross_validation.html) y [ajuste multimetricas](https://scikit-learn.org/stable/modules/grid_search.html).
