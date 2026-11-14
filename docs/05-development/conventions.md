# Convenciones de código

> TL;DR: Comentarios arriba (nunca al lado) y explicando el porqué; banners de sección; TS strict sin any; Python PEP 8 tipado; Pydantic en todos los bordes; router → service → engine → provider.
> Depende de: nada.
> Estado: draft
> Última revisión: 2026-11-14

## Comentarios

- **Siempre arriba** de la línea o función que describen. **Nunca al lado.**
- Comentar el **por qué**, no el qué.
- Secciones lógicas con banner:

```ts
// ─────────────────────────────────────────
// Section: Water balance chart
// ─────────────────────────────────────────
```

```python
# ─────────────────────────────────────────
# Section: Daily water balance
# ─────────────────────────────────────────
```

- Docstrings en Python para funciones públicas del engine: entradas, salidas, unidades y ecuación de FAO-56 citada.

## Idioma

Prosa de docs en español; código, identificadores, comentarios, commits y mensajes de log en inglés. Textos de UI en español.

## Nombres

| Elemento | TypeScript / web | Python |
|---|---|---|
| Archivos | kebab-case (`crop-field.tsx`) | snake_case (`water_balance.py`), PEP 8 |
| Clases / componentes | PascalCase | PascalCase |
| Variables / funciones | camelCase | snake_case |
| Constantes | UPPER_SNAKE_CASE | UPPER_SNAKE_CASE |
| Campos JSON de API | snake_case (igual que Pydantic) | snake_case |

Python usa snake_case por PEP 8 al ser el stack del backend (ADR-002).

## TypeScript

- `strict: true` (y `noUncheckedIndexedAccess`). **Prohibido `any`**: usar `unknown` + type guards.
- `interface` para contratos externos (respuestas de API); `type` para tipos internos.
- `enum` (o unión literal con `as const`, decidir una y mantenerla) para estados y roles: `DataState`, `TwinLevel`, `PhenoStage`.

```ts
export enum DataState {
  Measured = "MEASURED",
  Declared = "DECLARED",
  Estimated = "ESTIMATED",
  Simulated = "SIMULATED",
  Synthetic = "SYNTHETIC",
}

// Guard keeps unknown API payloads from leaking unchecked into the store
export function isDataState(value: unknown): value is DataState {
  return typeof value === "string" && (Object.values(DataState) as string[]).includes(value);
}
```

## Python

- Type hints completos; `mypy --strict` en `engine/`. Sin `Any` en el engine.
- `Enum(str, Enum)` para estados.
- Pydantic v2 en **todos** los bordes (request, response, archivos de `derived/` al cargarlos).
- Engine: funciones puras; sin `print`, sin I/O, sin `datetime.now()`, sin aleatoriedad global.
- Formato y lint: `ruff format` + `ruff check`.

## Capas

```
router (api/)  →  service (services/)  →  engine (engine/, puro)  →  provider (providers/, puertos)
```
- **Ninguna lógica de negocio en routers.**
- El engine no importa FastAPI, providers ni services.
- Cada valor expuesto lleva `data_state` y provenance ([data-contracts](../01-architecture/data-contracts.md)).

## Ciencia y honestidad

- No inventar cifras científicas: `TBD (verificar fuente: ...)` en código y docs hasta tener fuente.
- Unidades en el nombre cuando no son obvias: `precip_mm`, `et0_mm`, `awc_mm_per_m`.
- El score nunca se nombra ni presenta como probabilidad.

## Entrega

- Código completo y funcional, no snippets.
- Ante ambigüedad: tomar la decisión, documentarla (comentario de porqué o ADR en [decisions](../00-overview/decisions.md)) y seguir.
- Commits: Conventional Commits ([git-workflow](git-workflow.md)).
