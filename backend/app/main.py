"""FastAPI application: CORS for the local frontend, routers and error mapping."""

from __future__ import annotations

import http.client
import logging
import urllib.error

import requests
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.imagery import router as imagery_router
from app.api.points import router as points_router
from app.api.routes import router
from app.config import get_settings
from app.providers.ports import DataNotFoundError, InvalidFarmIdError, UpstreamUnavailableError
from app.services.errors import InvalidRequestError
from app.storage.ports import StoreUnavailableError

logger = logging.getLogger(__name__)

# Network failures of external data APIs that escape a provider: transient, so 503 instead of a bare 500
UPSTREAM_ERRORS: tuple[type[Exception], ...] = (
    TimeoutError,
    ConnectionError,
    urllib.error.URLError,
    http.client.HTTPException,
    requests.RequestException,
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AGROX digital twin API",
        version=settings.version,
        description="Exploratory simulation: no yield prediction. Every figure carries data_state and provenance.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(imagery_router)
    app.include_router(points_router)

    @app.exception_handler(RequestValidationError)
    async def invalid_payload(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Omit raw input so non-standard NaN JSON and arbitrary payloads cannot
        # break error serialization or echo sensitive input to clients.
        details = [{"loc": err["loc"], "msg": err["msg"], "type": err["type"]} for err in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": details})

    # Domain errors are mapped here so routers stay one-liners
    @app.exception_handler(DataNotFoundError)
    async def not_found(_: Request, exc: DataNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(InvalidFarmIdError)
    async def invalid_farm(_: Request, exc: InvalidFarmIdError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(InvalidRequestError)
    async def invalid(_: Request, exc: InvalidRequestError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(UpstreamUnavailableError)
    async def upstream_down(_: Request, exc: UpstreamUnavailableError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    async def upstream_failed(request: Request, exc: Exception) -> JSONResponse:
        logger.warning("upstream failure on %s: %s: %s", request.url.path, type(exc).__name__, exc)
        return JSONResponse(
            status_code=503,
            content={"detail": "Un servicio de datos externo no respondió a tiempo; reintenta en unos minutos."},
        )

    for error in UPSTREAM_ERRORS:
        app.add_exception_handler(error, upstream_failed)

    @app.exception_handler(StoreUnavailableError)
    async def unavailable(_: Request, exc: StoreUnavailableError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Data storage unavailable"})

    return app


app = create_app()
