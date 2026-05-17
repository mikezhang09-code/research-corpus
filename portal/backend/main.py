from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import artifacts, library, library_notebooks, notebooks


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    # Validate connections on startup
    from .database import get_supabase
    from .storage import get_r2

    get_supabase()
    get_r2()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Research Portal API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(notebooks.router)
    app.include_router(artifacts.router)
    app.include_router(library.router)
    app.include_router(library_notebooks.router)

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
