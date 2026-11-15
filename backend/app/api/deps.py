"""FastAPI dependencies: the only place where routers obtain adapters."""

from __future__ import annotations

from app.providers.factory import Providers, get_providers


def providers_dep() -> Providers:
    return get_providers()
