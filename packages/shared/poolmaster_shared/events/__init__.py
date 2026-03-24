"""Event schema definitions — shared message contracts between services."""

from poolmaster_shared.events.base import DomainEvent
from poolmaster_shared.events.scoring import StatEvent, ScoreUpdatedEvent
from poolmaster_shared.events.draft import DraftPickMadeEvent, DraftCompletedEvent
from poolmaster_shared.events.contest import ContestLockedEvent, ContestCompletedEvent

__all__ = [
    "DomainEvent",
    "StatEvent",
    "ScoreUpdatedEvent",
    "DraftPickMadeEvent",
    "DraftCompletedEvent",
    "ContestLockedEvent",
    "ContestCompletedEvent",
]
