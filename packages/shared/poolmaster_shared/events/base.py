"""Base event class for all domain events."""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import Field

from poolmaster_shared.domain.base import BaseModel


class DomainEvent(BaseModel):
    """Base for all events published to the message bus."""

    id: UUID = Field(default_factory=uuid4)
    type: str
    source_service: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    tenant_id: UUID
