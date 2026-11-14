# Playbook de agentes

> TL;DR: Cómo arranca un agente una tarea, cómo la entrega (definición de terminado) y la plantilla de brief que escribe el HEAD.
> Depende de: [agent-routing](agent-routing.md), [git-workflow](../05-development/git-workflow.md), [conventions](../05-development/conventions.md)
> Estado: draft
> Última revisión: 2026-11-14

## Arranque (constructor)

1. Lee el **brief** completo. Si falta algo esencial, pregúntalo al HEAD antes de codificar; si es menor, decide y documenta.
2. Lee `docs/navigation.yaml` → `by_role.builder` + el `task_path` indicado en el brief. Nada más salvo que el brief lo pida.
3. Crea rama y worktree desde `main`: `feat/<modulo>-<descripcion-corta>` ([git-workflow](../05-development/git-workflow.md)).
4. Escribe primero los tests (o al menos los de contrato/invariantes) y luego el código.
5. Ejecuta lint + tests localmente. Sin red en tests.
6. Actualiza docs afectados en el mismo PR (contrato, módulo, `navigation.yaml`).
7. Abre PR con la plantilla y pide revisión al revisor indicado en [agent-routing](agent-routing.md).

## Arranque (revisor)

1. Lee `by_role.reviewer` + task_path `review-pr` + el doc del módulo tocado.
2. Revisa el diff contra la definición de terminado (abajo). Ejecuta los tests.
3. Resultado: `APPROVE`, `REQUEST_CHANGES` (lista numerada, accionable) o `ESCALATE` (a Fable, si es decisión de arquitectura u honestidad).

## Definición de terminado

- [ ] Hace lo que pide el brief; criterios de aceptación cumplidos.
- [ ] Capas respetadas: router → service → engine (puro) → provider.
- [ ] Contratos Pydantic/TS en los bordes; sin `any` (TS) ni `Any` en engine (Python).
- [ ] Todo valor expuesto con `data_state` y provenance; sintético etiquetado y con banner en UI.
- [ ] Sin cifras científicas inventadas (`TBD (verificar fuente: ...)` donde falte).
- [ ] Score nunca presentado como probabilidad; sin promesas de rendimiento.
- [ ] Tests nuevos verdes; golden sin cambios no justificados; lint limpio.
- [ ] Comentarios arriba, en inglés, explicando el porqué; banners de sección.
- [ ] Docs y `navigation.yaml` actualizados si aplica.
- [ ] Sin secretos, `data/`, `.env`, nombres reales de bucket ni IDs de cuenta.
- [ ] Rama `feat/…` desde `main`; Conventional Commits; revisor distinto del constructor.

## Plantilla de brief de tarea (la escribe el HEAD)

```markdown
# Brief: <short title>

- id: T-<phase>-<nn>                  # e.g. T-F1-03
- phase: F1
- branch: feat/<module>-<short-desc>
- builder: <model id>   reviewer: <model id, different agent>
- task_path: <key in navigation.yaml>
- budget: <= 4 h

## Goal
<one or two sentences: what exists when this is done>

## Context (only what is not in the task_path docs)
<links to specific sections, decisions, open questions>

## Inputs / outputs
<function signatures, endpoints, files in derived/, Pydantic models touched>

## Acceptance criteria
1. <observable, testable>
2. <...>

## Out of scope
<what NOT to do>

## Decisions allowed to the builder
<what the builder can decide alone and must document>
```

## Cuándo parar y escalar

- Dos intentos fallidos (Sonnet) → Opus.
- La tarea requiere cambiar un contrato no previsto en el brief → avisar al HEAD antes de cambiarlo.
- Un dato real contradice al sintético de forma que cambia una conclusión → avisar al HEAD (honestidad).
- Duda sobre qué se puede afirmar en la UI/pitch → Fable.
