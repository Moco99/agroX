"""Service-level errors mapped to HTTP codes in app/main.py (routers stay free of logic)."""

from __future__ import annotations


class InvalidRequestError(ValueError):
    """Request is well-formed but outside what the data/engine supports (HTTP 422)."""
