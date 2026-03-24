"""Tenant domain model."""

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel


class Tenant(DomainModel):
    """A tenant is an organisation that owns leagues and users on the platform."""

    name: str
    slug: str
    plan_tier: str = "free"
    settings: dict = Field(default_factory=dict)
