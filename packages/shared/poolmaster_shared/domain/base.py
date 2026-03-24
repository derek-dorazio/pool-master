"""Base model classes for all domain types."""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel as PydanticBaseModel
from pydantic import ConfigDict, Field


class BaseModel(PydanticBaseModel):
    """Base for all Pydantic models in the domain."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
    )


class DomainModel(BaseModel):
    """Base for all persistent domain entities with standard fields."""

    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
