# AI Copilot (`copilot`) — opcional

> TL;DR: Redacta en español explicaciones de resultados ya calculados. Nunca calcula, nunca inventa cifras ni datos NASA. Plantillas deterministas como respaldo.
> Depende de: [data-contracts](../01-architecture/data-contracts.md)
> Estado: draft (entra al MVP solo si sobra tiempo, O-9)
> Última revisión: 2026-11-14

Endpoint: `POST /api/copilot/explain`.

## Contrato de comportamiento

- **Entrada:** exclusivamente datos estructurados del motor (`Recommendation`, `TwinState` resumido, `Discrepancy`, provenance, warnings) + pregunta del usuario.
- **Salida:** texto en español + lista de `cited_fields` (qué campos de la entrada usó).
- Preguntas tipo: "¿Por qué quedó primero este escenario?", "¿Qué limitaciones tiene?".
- Prohibido: calcular puntuaciones, crear datos, presentar el score como probabilidad, prometer rendimiento.
- Si un dato es `SYNTHETIC`, el texto lo dice explícitamente.

## Modos

| Modo | Cuándo | Cómo |
|---|---|---|
| `template` | Sin llave de LLM, sin red, o fallo del proveedor | Plantillas deterministas (f-strings) sobre los campos |
| `llm` | Llave disponible | Claude con prompt de sistema restrictivo + datos en JSON |

El modo `template` es obligatorio y es el que se testea; `llm` es mejora.

## Esquema de respuesta

```json
{"mode": "template", "text": "La rotación corn → soybean → corn quedó primera porque...",
 "cited_fields": ["recommendations[0].indicators.water", "warnings"], "disclaimer": "Exploratory result, not a yield prediction."}
```

## Guardas

- Validar que cada número que aparece en `text` exista en la entrada (test de "no cifras inventadas": extraer números del texto y compararlos).
- Timeout corto; ante error, caer a `template`.
- Llave en variable de entorno (`ANTHROPIC_API_KEY`), nunca en git ni en el frontend.

## Implementación

- `services/copilot_service.py` (elige modo), `copilot/templates.py`, `copilot/llm_client.py`.
- Builder: Sonnet. Revisor de textos/prompt: Fable (honestidad). Ver [agent-routing](../06-agents/agent-routing.md).
