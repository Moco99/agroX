# AGROX · docs para agentes

> TL;DR: Documentación mínima y enlazada para que agentes de codificación entiendan AGROX gastando pocos tokens.
> Depende de: nada (punto de entrada).
> Estado: draft
> Última revisión: 2026-11-14

## Regla número 1

**Lee [`navigation.yaml`](navigation.yaml) primero.** Ahí está:

- `by_role`: lectura mínima obligatoria según tu rol (`head`, `builder`, `reviewer`).
- `task_paths`: lista ordenada y cerrada de docs para cada tipo de tarea. Si tu tarea encaja en un `task_path`, lee **solo** esos docs, en ese orden.
- `docs[*].depends_on`: si necesitas un doc fuera de tu `task_path`, lee también sus `depends_on` (transitivos) antes.
- `docs[*].est_tokens`: costo aproximado de cada doc. No cargues lo que no vas a usar.

## Cómo cargar solo lo necesario

1. Identifica tu rol y tu tarea (el brief de tarea los dice; ver [agent-playbook](06-agents/agent-playbook.md)).
2. Busca el `task_path` que encaja. Si ninguno encaja, usa `plan-or-decide` y pide al HEAD que defina uno.
3. Lee cada doc de arriba abajo; el bloque `> TL;DR` te dice en 1 línea si lo necesitas entero.
4. Ante una contradicción entre docs: gana el **doc dueño** del tema (tabla abajo) y, sobre todos, [decisions](00-overview/decisions.md).

## Docs dueños (cero duplicación)

| Tema | Doc dueño |
|---|---|
| Términos e IDs | [glossary](00-overview/glossary.md) |
| ADRs y decisiones abiertas | [decisions](00-overview/decisions.md) |
| Contrato de API y modelos Pydantic | [data-contracts](01-architecture/data-contracts.md) |
| Ecuaciones, unidades, entradas/salidas | [model-specs](03-models/model-specs.md) |
| Dónde/por qué se usa cada modelo | [models-catalog](03-models/models-catalog.md) |
| Fuentes de datos y su estado | [sources](04-data/sources.md) |
| Cómo usar los datos (API, punto global, límites) | [data-guide](04-data/data-guide.md) |
| Datos sintéticos | [synthetic-data](04-data/synthetic-data.md) |
| Fases y checklist sintético→real | [roadmap](05-development/roadmap.md) |
| Ramas, PRs, revisión | [git-workflow](05-development/git-workflow.md) |
| Estilo de código | [conventions](05-development/conventions.md) |
| Qué modelo de IA hace qué | [agent-routing](06-agents/agent-routing.md) |
| Pantallas, layout, brecha mockup↔real | [ui-spec](07-design/ui-spec.md) |
| Colores, tipografía, escala NDVI | [design-tokens](07-design/design-tokens.md) |

## Mapa de carpetas

```
00-overview/      qué es, términos, decisiones
01-architecture/  sistema, stack, repo, contratos
02-modules/       un doc por módulo del producto
03-models/        modelos científicos: catálogo y especificaciones
04-data/          fuentes, S3, datos sintéticos
05-development/   roadmap, git, convenciones, tests
06-agents/        ruteo de modelos y playbook de agentes
07-design/        ui-spec, design tokens y mockups/ (JPG de referencia, no se listan en navigation.yaml)
```

Mockups: [S1 globo](07-design/mockups/01-globe-exploration.jpg) · [S2 parcela](07-design/mockups/02-parcel-ndvi.jpg) · [S3 gemelo](07-design/mockups/03-digital-twin.jpg). Son ilustrativos (ADR-010); los agentes deberían leer `ui-spec` en vez de abrirlos.

## Mantenimiento

- Si cambias un contrato o un módulo, actualiza su doc en el mismo PR (o vía rama `docs`) y `navigation.yaml` (ver [git-workflow](05-development/git-workflow.md)).
- Límite: ~150 líneas por doc. Si crece, divide y registra el nuevo doc en `navigation.yaml`.
- Nunca escribas llaves, IDs de cuenta ni nombres reales de bucket: el repo es público.
