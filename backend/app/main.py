"""FastAPI application: CORS for the local frontend, routers and error mapping."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.imagery import router as imagery_router
from app.api.routes import router
from app.config import get_settings
from app.providers.ports import DataNotFoundError
from app.services.errors import InvalidRequestError
from app.storage.ports import StoreUnavailableError


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

    # Domain errors are mapped here so routers stay one-liners
    @app.exception_handler(DataNotFoundError)
    async def not_found(_: Request, exc: DataNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(InvalidRequestError)
    async def invalid(_: Request, exc: InvalidRequestError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(StoreUnavailableError)
    async def unavailable(_: Request, exc: StoreUnavailableError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Data storage unavailable"})

    return app


app = create_app()
