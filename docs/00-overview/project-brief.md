# Project brief

> TL;DR: AGROX compara rotaciones de cultivo de una parcela con datos NASA, sobre un gemelo digital hídrico-fenológico; el motor calcula y el 3D explica.
> Depende de: [glossary](glossary.md)
> Estado: draft
> Última revisión: 2026-11-14

## Qué es

**AGROX — Agricultural Intelligence & 3D Digital Farm.** Plataforma web para explorar el futuro de una parcela: el productor elige parcela, registra historial, consulta indicadores, compara rotaciones y simula escenarios.

- Evento: NASA Space Apps 2026, reto "Adapting farms with NASA data". ~36 h.
- Marca: Velantex. Dueño: Moco. Equipo pequeño + agentes de IA.
- Idioma: prosa en español; código, identificadores y comentarios técnicos en inglés.

## Piloto

| Campo | Valor |
|---|---|
| Región | Story County, cerca de Ames, Iowa (FIPS 19169) |
| Zona | bbox `[-93.55, 41.95, -93.43, 42.04]` (~10×10 km) |
| Sistema | Rotación maíz–soya (+ una cobertura: centeno u avena) |
| Datos en el scraper | 2023-01-01 .. 2024-12-31 |
| Región futura | Veracruz, México (maíz–frijol), la del dossier original |

El cambio Veracruz → Iowa está en ADR-001, **pendiente de confirmación explícita del equipo** ([decisions](decisions.md)).

## Problema → respuesta

| Problema | Respuesta |
|---|---|
| Información fragmentada | Concentra clima, suelo e historial de la parcela. |
| Decisiones difíciles de comparar | Rotaciones con puntuación explicable y restricciones visibles. |
| Riesgo climático | Escenarios de lluvia/temperatura, años análogos, Monte Carlo. |
| Ciencia poco accesible | Indicadores traducidos a lenguaje y visualizaciones útiles. |

## Diferenciador

- **Orientado a rotaciones**, no un dashboard meteorológico genérico.
- **Explicable**: score, criterios, restricciones y fuentes en cada recomendación.
- **Gemelo digital real y honesto**: estado diario sincronizado con observaciones satelitales; muestra la discrepancia.
- **Honesto**: cada dato lleva `DataState`; el score **nunca** se presenta como probabilidad de éxito; no predice rendimiento; el 3D es ilustrativo.

## Módulos

| Módulo | Prioridad | Doc |
|---|---|---|
| Digital Twin Engine | Crítica (núcleo) | [digital-twin-engine](../02-modules/digital-twin-engine.md) |
| Earth Scanner | Crítica | [earth-scanner](../02-modules/earth-scanner.md) |
| Digital Farm (2D + 3D) | Crítica | [digital-farm-3d](../02-modules/digital-farm-3d.md) |
| Rotation Engine | Crítica | [rotation-engine](../02-modules/rotation-engine.md) |
| Crop Catalog | Crítica | [crop-catalog](../02-modules/crop-catalog.md) |
| What If | Alta | [what-if-scenarios](../02-modules/what-if-scenarios.md) |
| AI Copilot | Opcional | [ai-copilot](../02-modules/ai-copilot.md) |

## Recorrido de usuario (demo de 4 min)

1. Elegir parcela (mapa 2D).
2. Registrar contexto: cultivo actual/previo, riego, mes de siembra (`DECLARED`).
3. Analizar: clima NASA, indicadores, estado del gemelo (agua en suelo, etapa, estrés).
4. Explorar: tres rotaciones (continuidad, diversificación, cobertura) con score y restricciones.
5. Simular: cambiar lluvia/temperatura/pesos/ciclo → ranking y escena 3D cambian.
6. Compartir: resumen con metodología y fuentes.

## Fuera de alcance (hackathon)

- Predicción de rendimiento, erosión, nitrógeno o agua exacta por parcela.
- Cobertura global o catálogo extenso de cultivos.
- Crecimiento 3D físicamente validado.
- ML dentro del motor (solo como contraste, ver [models-catalog](../03-models/models-catalog.md)).

## Identidad visual (del dossier)

Paleta del dossier: Forest, Agro Green, Mint, Solar, Canvas (clara). Ahora predomina el tema oscuro de los mockups (ADR-011); valores en [design-tokens](../07-design/design-tokens.md), pantallas en [ui-spec](../07-design/ui-spec.md). Regla: ninguna cifra sin unidad; ninguna etiqueta tipo "riesgo alto" sin explicar su fórmula.
