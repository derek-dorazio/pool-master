"""League domain models."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel
from poolmaster_shared.domain.enums import LeagueRole, LeagueVisibility


class League(DomainModel):
    """A league within a tenant — the primary grouping of members and contests."""

    tenant_id: UUID
    name: str
    description: str | None = None
    created_by: UUID
    visibility: LeagueVisibility = LeagueVisibility.PRIVATE
    max_members: int = 20
    settings: dict = Field(default_factory=dict)


class LeagueMembership(DomainModel):
    """A user's membership in a league with their role."""

    league_id: UUID
    user_id: UUID
    role: LeagueRole = LeagueRole.MANAGER
    joined_at: datetime = Field(default_factory=datetime.utcnow)
