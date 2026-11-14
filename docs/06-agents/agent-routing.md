# Ruteo de modelos (agentes)

> TL;DR: Fable 5.1 = HEAD (plan, ADRs, honestidad científica, pitch). Opus 5.5 = núcleo científico, contratos y revisión de lógica. Sonnet 5.5 = UI, cableado, fixtures, tests rutinarios, docs. Revisor siempre distinto y de nivel ≥ en lógica.
> Depende de: nada.
> Estado: draft
> Última revisión: 2026-11-14

Decisión: ADR-007 en [decisions](../00-overview/decisions.md).

## Roles

| Modelo | ID | Rol | Hace | No hace |
|---|---|---|---|---|
| **Fable 5.1** | `claude-fable-5-1` | **HEAD** | Planificación y descomposición en tareas (briefs); ADRs; resolver desacuerdos entre revisores; guardián de honestidad científica (qué se puede afirmar); narrativa, pitch y textos de la UI sensibles | Código masivo (costo) |
| **Opus 5.5** | `claude-opus-5-5` | Núcleo + revisor de lógica | Engine del gemelo (ET0, balance hídrico, GDD, sincronización/nudging, Monte Carlo, años análogos); Rotation Engine y scoring; esquemas y contratos; SSURGO/SDA; arreglos STAC; catálogo verificado; backtest | UI repetitiva, cableado simple |
| **Sonnet 5.5** | `claude-sonnet-5-5` | Volumen y velocidad | UI React/Leaflet/Recharts/R3F (geometría procedural); modelos Pydantic repetitivos; cableado de endpoints; generadores sintéticos y fixtures; tests de rutina; mantenimiento de docs; revisión de UI/código simple | Ecuaciones científicas, cambios de contrato sin Opus |
| Haiku 5.5 (opcional) | ID a confirmar | Trivial | Formato, renombres, ajustes de imports | Cualquier lógica |

Por qué: el núcleo científico es donde un error silencioso invalida la demo (Opus); la UI es volumen con verificación visual barata (Sonnet); las decisiones y la honestidad del mensaje requieren el mejor juicio pero pocos tokens (Fable).

## Reglas

1. **Nunca auto-revisión:** el revisor es otro agente.
2. **Lógica:** revisor de modelo ≥ constructor (Sonnet construye lógica → Opus revisa; Opus construye → otro Opus revisa).
3. **Escalado:** si una tarea de Sonnet falla dos veces (tests rojos o revisión rechazada) o toca ciencia/contratos → pasa a Opus.
4. **Fable solo como HEAD:** no implementa features; sí escribe ADRs, briefs y textos de pitch.
5. Desacuerdo constructor–revisor → decide Fable; si es arquitectónico, ADR.
6. Todo agente sigue [agent-playbook](agent-playbook.md).

## Matriz tarea → modelo → revisor

| Tarea | Constructor | Revisor |
|---|---|---|
| Plan de fase, briefs, ADR | Fable | Moco (humano) |
| `schemas/` y contratos API | Opus | Fable (alcance) + Opus distinto (tipos) |
| Esqueleto FastAPI / Vite | Sonnet | Opus |
| Engine: ET0, Kc, balance hídrico, GDD | Opus | Opus distinto |
| Engine: años análogos, Monte Carlo, nudging | Opus | Opus distinto |
| Rotation Engine (reglas, indicadores, score) | Opus | Opus distinto + Fable (mensaje) |
| Generadores sintéticos | Sonnet | Opus |
| Providers `Real*` simples (CSV POWER) | Sonnet | Opus |
| SSURGO/SDA, arreglo STAC Sentinel-2/Landsat | Opus | Opus distinto |
| Catálogo de cultivos verificado | Opus | Fable (honestidad de fuentes) |
| Routers / cableado de endpoints | Sonnet | Sonnet distinto (Opus si toca lógica) |
| UI mapa, gráficas, paneles | Sonnet | Sonnet distinto |
| Escena 3D R3F | Sonnet | Sonnet distinto |
| UI shell (sidebar, topbar, paneles, timeline) | Sonnet | Sonnet distinto |
| Design tokens (`tokens.ts`, Tailwind) | Sonnet | Sonnet distinto |
| Diorama R3F por zonas (mapeo `ZoneResult`/`TwinState` → color) | Sonnet | Sonnet distinto + Opus (mapeo de datos y escalas) |
| Globo S1 (stretch) | Sonnet | Sonnet distinto |
| Overlay NDVI: recorte + PNG en backend | Sonnet | Opus (resolución, QA de nubes, escala) |
| Overlay NDVI en mapa (frontend) | Sonnet | Sonnet distinto |
| i18n es-MX (`i18n/es.ts`) y copy de UI | Sonnet | Fable (textos sensibles: score, simulación, AGROX AI) |
| Revisión de diseño vs mockups y brecha de honestidad | Fable | Moco |
| Tests de contrato (definición) | Opus | Opus distinto |
| Tests rutinarios / fixtures | Sonnet | Sonnet distinto |
| Copilot (templates, cliente LLM) | Sonnet | Fable (textos) + Opus (guardas) |
| Backtest ML vs NASS | Opus | Fable (qué se puede afirmar) |
| Docs (mantenimiento) | Sonnet | Fable si cambia una decisión |
| Formato / renombres | Haiku o Sonnet | Sonnet |
| Guion de demo y pitch | Fable | Moco |

## Control de costos

- Cargar solo el `task_path` de [navigation.yaml](../navigation.yaml); nunca "leer todo docs/".
- Fable recibe resúmenes (diffs, reportes de tests), no repos completos.
- Briefs autocontenidos para que el constructor no explore de más ([agent-playbook](agent-playbook.md)).
- Preferir Sonnet para todo lo que no sea ciencia, contratos o decisiones; escalar solo con la regla 3.
- Revisores leen el diff + docs del task_path `review-pr`, no el repo entero.
- Contexto largo: resumir y reiniciar en lugar de arrastrar conversaciones enormes.
