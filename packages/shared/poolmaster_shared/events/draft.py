"""Draft-related events."""

from uuid import UUID

from poolmaster_shared.events.base import DomainEvent


class DraftPickMadeEvent(DomainEvent):
    """Published when a pick is made during a draft."""

    type: str = "draft.pick_made"
    source_service: str = "draft-service"
    contest_id: UUID
    draft_session_id: UUID
    team_id: UUID
    participant_id: UUID
    pick_number: int
    round: int
    auto_picked: bool


class DraftCompletedEvent(DomainEvent):
    """Published when a draft finishes."""

    type: str = "draft.completed"
    source_service: str = "draft-service"
    contest_id: UUID
    draft_session_id: UUID
    total_picks: int
