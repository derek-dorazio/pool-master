"""Domain models — Pydantic types for the PoolMaster domain."""

from poolmaster_shared.domain.base import BaseModel, DomainModel
from poolmaster_shared.domain.enums import (
    ContestStatus,
    ContestType,
    DraftMode,
    DraftType,
    LeagueRole,
    MembershipRole,
    ParticipantType,
    ScoringType,
    Sport,
)
from poolmaster_shared.domain.tenant import Tenant
from poolmaster_shared.domain.user import User
from poolmaster_shared.domain.league import League, LeagueMembership
from poolmaster_shared.domain.sport import SportConfig, Season, Participant
from poolmaster_shared.domain.contest import Contest, DraftConfiguration, ContestParticipantPool
from poolmaster_shared.domain.team import Team, TeamRoster
from poolmaster_shared.domain.draft import DraftSession, DraftPick

__all__ = [
    "BaseModel",
    "DomainModel",
    "ContestStatus",
    "ContestType",
    "DraftMode",
    "DraftType",
    "LeagueRole",
    "MembershipRole",
    "ParticipantType",
    "ScoringType",
    "Sport",
    "Tenant",
    "User",
    "League",
    "LeagueMembership",
    "SportConfig",
    "Season",
    "Participant",
    "Contest",
    "DraftConfiguration",
    "ContestParticipantPool",
    "Team",
    "TeamRoster",
    "DraftSession",
    "DraftPick",
]
