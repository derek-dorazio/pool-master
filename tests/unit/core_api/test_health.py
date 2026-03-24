"""Unit tests for the Core API health endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient

from services.core_api.app.main import app


@pytest.mark.unit
@pytest.mark.anyio
async def test_health_check_returns_ok():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "core-api"
