"""Draft session and pick domain models."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel
from poolmaster_shared.domain.enums import DraftStatus


class DraftSession(DomainModel):
    """A draft session for a contest."""

    contest_id: UUID
    status: DraftStatus = DraftStatus.PENDING
    current_pick_number: int = 0
    current_team_id: UUID | None = None
    started_at: datetime | None = None
    pick_deadline: datetime | None = None


class DraftPick(DomainModel):
    """A single pick made during a draft."""

    draft_session_id: UUID
    team_id: UUID
    participant_id: UUID
    pick_number: int
    round: int
    pick_in_round: int
    picked_at: datetime = Field(default_factory=datetime.utcnow)
    auto_picked: bool = False
