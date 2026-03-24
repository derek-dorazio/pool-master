"""Sport and participant domain models."""

from datetime import date
from uuid import UUID

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel
from poolmaster_shared.domain.enums import ParticipantType, Sport


class SportConfig(DomainModel):
    """Configuration for a sport — defines what stats are tracked."""

    name: Sport
    participant_type: ParticipantType
    stat_schema: dict = Field(default_factory=dict)


class Season(DomainModel):
    """A season within a sport for a tenant."""

    sport_id: UUID
    tenant_id: UUID
    name: str
    year: int
    start_date: date
    end_date: date


class Participant(DomainModel):
    """A sport participant — golfer, driver, team, horse, etc."""

    sport_id: UUID
    name: str
    external_id: str | None = None
    metadata: dict = Field(default_factory=dict)
