# Contribuir a AGROX

Gracias por querer ayudar. Esta guía resume lo necesario para abrir un buen PR. El detalle completo está en [`docs/05-development/`](docs/05-development/).

## Antes de empezar

1. Lee el [README](README.md) y la sección de **honestidad científica**: es la regla que más importa en este proyecto.
2. Busca un issue abierto o abre uno describiendo qué quieres cambiar y por qué. Para cambios grandes (contratos de API, modelos, arquitectura), discútelo primero en el issue.
3. Levanta el proyecto con `make setup && make dev`.

## Reglas que no se negocian

- **Honestidad científica.** Todo valor expuesto lleva `data_state` (`MEASURED`, `DECLARED`, `ESTIMATED`, `SIMULATED`, `SYNTHETIC`). El puntaje es un índice comparativo, nunca una probabilidad, y no se promete predicción de rendimiento.
- **No inventes cifras científicas** (Kc, temperaturas base, retención de agua, umbrales). Si no tienes una fuente citable escribe `TBD (verificar fuente: ...)`. Si aportas una cifra, cita la fuente en el código o en el doc.
- **Engine puro.** Capas `router → service → engine → provider`. El engine no hace red, I/O ni usa aleatoriedad global.
- **Sin secretos.** Nunca subas llaves, `.env`, IDs de cuenta ni nombres reales de buckets, ni en commits, docs, logs o capturas. Los tests no usan red.
- **Datos grandes fuera de git.** `data/` no se versiona; solo los derivados pequeños de `backend/app/data/derived/`.

## Flujo de trabajo

1. Haz un fork (o una rama si tienes acceso) desde `main` actualizado. **No se commitea directo a `main`.**
2. Nombra la rama `feat/<modulo>-<descripcion>`, `fix/<modulo>-<descripcion>` o `chore/<descripcion>`. Una funcionalidad por rama; PRs pequeños son más fáciles de revisar.
3. Commits en [Conventional Commits](https://www.conventionalcommits.org/), en inglés: `feat(twin): add FAO-56 daily water balance step`. Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `ci`.
4. Antes de abrir el PR, corre lo mismo que revisa el proyecto:
   ```bash
   make lint
   make test
   make build
   ```
5. Abre el PR contra `main` y explica qué cambia, por qué y cómo lo probaste (capturas si toca la UI). Un PR se fusiona solo después de la revisión de **otra persona**, nunca de quien lo escribió.
6. Si cambias un contrato o un módulo, actualiza su doc en el mismo PR, y `docs/navigation.yaml` si añades, renombras o borras docs.

## Convenciones de código

Detalle en [`docs/05-development/conventions.md`](docs/05-development/conventions.md). Lo esencial:

- **Idiomas:** prosa y docs en español; **código, identificadores, comentarios y commits en inglés**; textos de la interfaz en español (es-MX), centralizados en `frontend/src/i18n/es.ts`.
- **Comentarios** arriba de la línea o función (nunca al lado), explicando el **porqué**. Las secciones largas usan banner:
  ```ts
  // ─────────────────────────────────────────
  // Section: Nombre de la sección
  // ─────────────────────────────────────────
  ```
  (En Python con `#`.)
- **TypeScript** en modo `strict`, sin `any` (usa `unknown` con type guards). Archivos en kebab-case.
- **Python** tipado, Pydantic v2 en todos los bordes de la API. Módulos en snake_case; campos JSON en snake_case.
- Código completo y funcional, no fragmentos. Ante una ambigüedad, decide y documenta el porqué (comentario o ADR).

## Pruebas

- Backend: pytest (unidad, contrato, golden). Frontend: Vitest.
- Todo cambio de lógica lleva su prueba. Los tests no usan red: usa los adaptadores sintéticos.
- Las explicaciones de la interfaz que describen fórmulas (`frontend/src/lib/formulas.test.ts`) están fijadas contra el código del motor; si cambias el cálculo, actualiza el texto y la prueba.
- Si tocas la escena 3D, comprueba que sigue fluida y que el 3D se mantiene rotulado como ilustrativo.

## Decisiones de arquitectura

Las decisiones importantes se registran como ADR en [`docs/00-overview/decisions.md`](docs/00-overview/decisions.md). Si tu cambio contradice una, propón la nueva decisión en el PR en lugar de saltártela. Un ejemplo: el motor es de caja blanca y no usa ML (ADR-005).

## Si usas un agente de IA

Los agentes de codificación deben leer [`CLAUDE.md`](CLAUDE.md) y empezar por [`docs/navigation.yaml`](docs/navigation.yaml), que indica qué documentos cargar según la tarea. Quien envía el PR es responsable de lo que contiene: revisa y prueba lo que genere el agente.

## Reportar problemas de seguridad

No abras un issue público con datos sensibles. Contacta a los mantenedores en privado (por ejemplo, mediante un aviso de seguridad privado de GitHub).

## Código de conducta

Sé respetuoso y constructivo. Las críticas van sobre el código y las ideas, no sobre las personas.
