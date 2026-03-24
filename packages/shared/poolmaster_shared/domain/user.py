"""User domain model."""

from uuid import UUID

from poolmaster_shared.domain.base import DomainModel


class User(DomainModel):
    """A user with a global identity, scoped to tenants via membership."""

    email: str
    display_name: str
    auth_provider: str | None = None
    auth_id: str | None = None
    tenant_id: UUID | None = None
