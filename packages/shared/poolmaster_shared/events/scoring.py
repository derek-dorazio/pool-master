"""Scoring-related events."""

from datetime import datetime
from uuid import UUID

from poolmaster_shared.events.base import DomainEvent


class StatEvent(DomainEvent):
    """A stat event ingested from a sports data provider."""

    type: str = "stat.received"
    source_service: str = "ingestion-worker"
    event_id: str
    participant_external_id: str
    participant_id: UUID | None = None
    stat_key: str
    stat_value: float
    round: int | None = None
    is_correction: bool = False
    corrects_event_id: str | None = None
    provider_id: str
    ingested_at: datetime


class ScoreUpdatedEvent(DomainEvent):
    """Published when a team's score changes in a contest."""

    type: str = "score.updated"
    source_service: str = "scoring-service"
    contest_id: UUID
    team_id: UUID
    old_score: float
    new_score: float
    rank: int
    rank_changed: bool
