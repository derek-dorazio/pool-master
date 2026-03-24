"""FastAPI application entry point for the Draft Service."""

from fastapi import APIRouter, FastAPI

app = FastAPI(
    title="PoolMaster Draft Service",
    description="Draft session lifecycle, live/async pick orchestration, WebSocket rooms",
    version="0.1.0",
)

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health_check() -> dict:
    return {"status": "ok", "service": "draft-service"}


app.include_router(health_router)
