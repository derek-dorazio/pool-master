"""FastAPI application entry point for the Scoring Service."""

from fastapi import APIRouter, FastAPI

app = FastAPI(
    title="PoolMaster Scoring Service",
    description="Consumes stat events, applies scoring rules, writes standings",
    version="0.1.0",
)

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health_check() -> dict:
    return {"status": "ok", "service": "scoring-service"}


app.include_router(health_router)
