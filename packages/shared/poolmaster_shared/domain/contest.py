"""Contest and draft configuration domain models."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from poolmaster_shared.domain.base import DomainModel
from poolmaster_shared.domain.enums import (
    ContestStatus,
    ContestType,
    DraftMode,
    DraftType,
    ScoringType,
)


class DraftConfiguration(DomainModel):
    """Configuration for how a contest's draft is run."""

    draft_type: DraftType
    draft_mode: DraftMode
    rounds: int
    time_per_pick_seconds: int = 60
    auto_pick_policy: str = "BEST_AVAILABLE"
    budget: int | None = None
    tier_config: dict | None = None
    is_exclusive: bool = True


class Contest(DomainModel):
    """A contest within a league — the core competitive unit."""

    league_id: UUID
    season_id: UUID
    name: str
    status: ContestStatus = ContestStatus.DRAFT
    contest_type: ContestType
    scoring_type: ScoringType
    draft_config_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    lock_at: datetime | None = None
    rules_config: dict = Field(default_factory=dict)


class ContestParticipantPool(DomainModel):
    """A participant's inclusion in a contest's available pool."""

    contest_id: UUID
    participant_id: UUID
    cost: int | None = None
    tier: str | None = None
    is_available: bool = True
