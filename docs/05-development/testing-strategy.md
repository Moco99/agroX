# Estrategia de pruebas

> TL;DR: pytest (unidad, contrato, golden, API) + Vitest + Playwright smoke. Los tests de contrato garantizan que Synthetic* y Real* son intercambiables.
> Depende de: [conventions](conventions.md)
> Estado: draft
> Última revisión: 2026-11-14

## Pirámide

| Tipo | Dónde | Qué verifica | Quién escribe |
|---|---|---|---|
| Unidad (engine) | `backend/tests/unit/` | Ecuaciones contra casos de referencia (ejemplos resueltos de FAO-56 cuando existan), invariantes | Opus |
| Contrato (providers) | `backend/tests/contract/` | Ambos adaptadores devuelven el mismo modelo y cumplen invariantes | Opus define, Sonnet amplía |
| Golden | `backend/tests/golden/` | Salida del gemelo con clima sintético + seed fija no cambia sin querer | Opus |
| API | `backend/tests/api/` | Rutas, validación 422, normalización de pesos, provenance presente | Sonnet |
| Arquitectura | `backend/tests/unit/test_layers.py` | `engine/` no importa `fastapi`, `providers`, `services`, `httpx`, `requests` | Sonnet |
| Frontend | `frontend/src/**/*.test.tsx` | Componentes, guards de tipos, banner sintético | Sonnet |
| E2E smoke | `frontend/e2e/` (Playwright) | Recorrido de la demo de 4 min en modo `synthetic` | Sonnet |

## Tests de contrato (parametrizados por adaptador)

```python
import pytest

from app.providers.ports import WeatherProvider
from app.providers.real.weather import RealWeatherProvider
from app.providers.synthetic.weather import SyntheticWeatherProvider
from app.schemas.common import DataState
from app.schemas.weather import WeatherSeries


# Real adapter is skipped until its derived file exists, so CI stays green during F1
def _providers() -> list[WeatherProvider]:
    providers: list[WeatherProvider] = [SyntheticWeatherProvider(seed=20261114)]
    if RealWeatherProvider.is_available():
        providers.append(RealWeatherProvider())
    return providers


@pytest.mark.parametrize("provider", _providers(), ids=lambda p: type(p).__name__)
def test_weather_contract(provider: WeatherProvider) -> None:
    series = provider.get_daily(lat=41.995, lon=-93.49, start="2024-01-01", end="2024-12-31")
    assert isinstance(series, WeatherSeries)
    assert all(day.precip >= 0 for day in series.days)
    assert all(day.t_min <= day.t_max for day in series.days)
    # Synthetic data must never pass as measured
    if isinstance(provider, SyntheticWeatherProvider):
        assert series.provenance.data_state is DataState.SYNTHETIC
```

## Invariantes del gemelo

- `0 ≤ root_zone_depletion_mm ≤ taw_mm`; `0 ≤ ks ≤ 1`; `et0 ≥ 0`; `gdd_cum` no decreciente.
- `fork` con escenario neutro (`precip_factor=1`, `temp_delta_c=0`) = `run_season`.
- Determinismo: dos corridas con la misma seed son idénticas.
- Menos lluvia (factor < 1) ⇒ `ks` medio no aumenta (propiedad monotónica).

## Reglas

- Ningún test usa red. Datos reales en tests: solo fixtures pequeños recortados en `tests/fixtures/`.
- Un cambio intencional en golden files se justifica en el PR.
- PR sin tests para lógica nueva = no aprobado ([agent-playbook](../06-agents/agent-playbook.md)).

## Comandos

```bash
# Backend
cd backend && ruff check . && mypy app/engine && pytest -q
# Frontend
cd frontend && npm run typecheck && npm run test && npx playwright test
```
(Gestor de paquetes del frontend: npm o pnpm, se fija en F0.)
