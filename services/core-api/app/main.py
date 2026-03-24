"""FastAPI application entry point for the Core API."""

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.leagues import router as leagues_router

app = FastAPI(
    title="PoolMaster Core API",
    description="Auth, leagues, memberships, contests, roster management, standings",
    version="0.1.0",
)

app.include_router(health_router)
app.include_router(leagues_router, prefix="/api/v1")
