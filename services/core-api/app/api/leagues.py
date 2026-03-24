"""League endpoints."""

from fastapi import APIRouter

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.get("")
async def list_leagues() -> dict:
    """List leagues for the current tenant."""
    return {"leagues": []}


@router.post("")
async def create_league() -> dict:
    """Create a new league."""
    return {"message": "not implemented"}
