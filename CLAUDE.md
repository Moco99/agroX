# AGROX · guía para agentes

AGROX es una plataforma web para comparar rotaciones de cultivos con datos de NASA, con un **gemelo digital hídrico-fenológico** de la parcela y un visor 3D (Three.js). Es un prototipo de hackathon (NASA Space Apps 2026, ~36 h). Piloto: Story County, Ames, Iowa (maíz–soya), pendiente de confirmar (ADR-001). **El repo es público.**

## Estado del repo

| Carpeta | Estado |
|---|---|
| `scraper/` | Existe. Baja datos de ~26 fuentes a `data/raw/` (ver `README.md`). |
| `docs/` | Existe. Contexto, decisiones y plan del proyecto. |
| `pipeline/`, `backend/`, `frontend/` | Por crear (fase F0). Estructura objetivo en `docs/01-architecture/repo-structure.md`. |
| `data/` | Fuera de git. Nunca la leas completa ni la subas. |

## Regla número 1: carga el contexto por `navigation.yaml`

Antes de tocar código, lee **`docs/navigation.yaml`** (no leas toda la carpeta `docs/`):

1. Mira `by_role` (`head`, `builder`, `reviewer`) y lee lo mínimo de tu rol.
2. Busca tu tarea en `task_paths` (p. ej. `implement-twin-engine`, `build-3d-scene`, `review-pr`) y lee **solo** esos docs, en ese orden. Ya incluyen sus dependencias.
3. Si dos docs se contradicen, gana el doc dueño del tema (tabla en `docs/README.md`) y, sobre todos, `docs/00-overview/decisions.md`.

## Reglas que no se negocian

- **Honestidad científica.** Todo valor expuesto lleva `data_state` (`MEASURED`, `DECLARED`, `ESTIMATED`, `SIMULATED`, `SYNTHETIC`). El score es un **índice comparativo**, nunca una probabilidad. No se promete predicción de rendimiento. El 3D es ilustrativo.
- **No inventes cifras científicas** (Kc, temperaturas base, retención de agua, umbrales): escribe `TBD (verificar fuente: ...)`.
- **Datos sintéticos primero, reales después.** El gemelo se desarrolla con datos falsos etiquetados `SYNTHETIC` (con aviso visible en la UI) detrás de puertos (`WeatherProvider`, `SoilProvider`, ...) y luego se cambian por los adaptadores reales. Ver `docs/05-development/roadmap.md`.
- **Capas:** `router → service → engine → provider`. El `engine` es puro: sin I/O, sin red, sin aleatoriedad global.
- **Secretos:** nunca llaves, `.env`, IDs de cuenta ni nombres reales de bucket en commits, docs ni logs. Los tests no usan red.
- **Mockups:** son referencia visual, no datos (ADR-010). La spec en texto está en `docs/07-design/ui-spec.md`; no abras las imágenes si no hace falta.

## Convenciones (detalle en `docs/05-development/conventions.md`)

- Prosa y docs en español; **código, identificadores, comentarios y commits en inglés**; textos de UI en español (es-MX).
- Comentarios **arriba** de la línea o función, nunca al lado, explicando el **porqué**. Secciones con banner `// ─── / // Section: Nombre / // ───` (en Python con `#`).
- TypeScript `strict`, sin `any` (usa `unknown` + type guards). Python tipado, Pydantic v2 en todos los bordes de la API.
- Archivos TS en kebab-case; módulos Python en snake_case. Campos JSON en snake_case.
- Código completo y funcional. Ante una ambigüedad, decide, documenta (ADR o comentario del porqué) y sigue.

## Git (detalle en `docs/05-development/git-workflow.md`)

- **Prohibido commitear directo a `main`.** Una feature = una rama `feat/<modulo>-<descripcion>` desde `main` = un worktree = un agente.
- PR a `main` solo tras revisión de **otro** agente (nunca auto-revisión). Features pequeñas (~4 h).
- Commits en Conventional Commits: `feat(twin): add FAO-56 daily water balance step`.
- Si cambias un contrato o un módulo, actualiza su doc y `docs/navigation.yaml` en el mismo PR.

## Quién hace qué (detalle en `docs/06-agents/agent-routing.md`)

| Modelo | Rol |
|---|---|
| **Fable 5.1** | HEAD: planifica, escribe ADRs y briefs, decide desacuerdos, vigila qué se puede afirmar. No escribe código masivo. |
| **Opus 5.5** | Núcleo difícil: engine del gemelo, scoring, contratos, parsing de suelo; revisa la lógica. |
| **Sonnet 5.5** | Volumen: UI, escena 3D, cableado de endpoints, datos sintéticos, tests de rutina, docs. |

Si una tarea de Sonnet falla dos veces o toca ciencia o contratos, pasa a Opus. Cómo arrancar y entregar una tarea (brief, definición de terminado): `docs/06-agents/agent-playbook.md`.

## Comandos que existen hoy

```bash
# Install the scraper dependencies (Python 3.10+)
pip install -r requirements.txt

# Download data for the pilot area into data/raw/ (writes data/manifest.csv)
python scraper/scrape.py            # all enabled sources
python scraper/scrape.py power cdl  # only some sources

# Scraper tests
python scraper/test_scrape.py
```

Las llaves van en `.env` (copia `.env.example`). Los comandos de `backend/` y `frontend/` se documentarán cuando existan (F0).

## Si dudas

Decisiones abiertas: `docs/00-overview/decisions.md` (O-1 a O-17). Términos e IDs: `docs/00-overview/glossary.md`. Si la tarea no encaja en ningún `task_path`, usa `plan-or-decide` y pide al HEAD que defina uno.
