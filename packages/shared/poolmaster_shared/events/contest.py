"""Contest lifecycle events."""

from datetime import datetime
from uuid import UUID

from poolmaster_shared.events.base import DomainEvent


class ContestLockedEvent(DomainEvent):
    """Published when a contest locks (no more picks/changes)."""

    type: str = "contest.locked"
    source_service: str = "core-api"
    contest_id: UUID
    locked_at: datetime


class ContestCompletedEvent(DomainEvent):
    """Published when a contest finishes and results are final."""

    type: str = "contest.completed"
    source_service: str = "core-api"
    contest_id: UUID
    winner_team_id: UUID | None = None
