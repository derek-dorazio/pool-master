"""FastAPI application entry point for the Notification Service."""

from fastapi import APIRouter, FastAPI

app = FastAPI(
    title="PoolMaster Notification Service",
    description="Push (APNs/FCM), email, in-app notifications",
    version="0.1.0",
)

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health_check() -> dict:
    return {"status": "ok", "service": "notification-service"}


app.include_router(health_router)
