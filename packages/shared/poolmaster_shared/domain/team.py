"""Team and roster domain models."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel


class Team(DomainModel):
    """A team in a contest, owned by a league member."""

    contest_id: UUID
    league_membership_id: UUID
    name: str


class TeamRoster(DomainModel):
    """A participant on a team's roster."""

    team_id: UUID
    participant_id: UUID
    drafted_at: datetime = Field(default_factory=datetime.utcnow)
    draft_round: int
    draft_pick_number: int
    is_active: bool = True
