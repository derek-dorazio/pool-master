"""Enumerations used across the PoolMaster domain."""

from enum import StrEnum


class Sport(StrEnum):
    GOLF = "GOLF"
    NFL = "NFL"
    NBA = "NBA"
    F1 = "F1"
    NASCAR = "NASCAR"
    NCAA_BASKETBALL = "NCAA_BASKETBALL"
    TENNIS = "TENNIS"
    HORSE_RACING = "HORSE_RACING"
    EPL = "EPL"
    NHL = "NHL"
    MLB = "MLB"


class ParticipantType(StrEnum):
    INDIVIDUAL = "INDIVIDUAL"
    TEAM = "TEAM"


class ContestType(StrEnum):
    SINGLE_EVENT = "SINGLE_EVENT"
    SEASON_LONG = "SEASON_LONG"
    BRACKET = "BRACKET"


class ScoringType(StrEnum):
    CUMULATIVE = "CUMULATIVE"
    KNOCKOUT = "KNOCKOUT"
    BRACKET = "BRACKET"
    STROKE_PLAY = "STROKE_PLAY"
    POSITION = "POSITION"
    ROTISSERIE = "ROTISSERIE"
    HEAD_TO_HEAD = "HEAD_TO_HEAD"


class DraftType(StrEnum):
    SNAKE = "SNAKE"
    SALARY_CAP = "SALARY_CAP"
    TIERED = "TIERED"


class DraftMode(StrEnum):
    LIVE = "LIVE"
    ASYNC = "ASYNC"


class ContestStatus(StrEnum):
    DRAFT = "DRAFT"
    OPEN = "OPEN"
    DRAFTING = "DRAFTING"
    LOCKED = "LOCKED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class DraftStatus(StrEnum):
    PENDING = "PENDING"
    LIVE = "LIVE"
    PAUSED = "PAUSED"
    COMPLETE = "COMPLETE"


class LeagueRole(StrEnum):
    OWNER = "OWNER"
    COMMISSIONER = "COMMISSIONER"
    MANAGER = "MANAGER"
    VIEWER = "VIEWER"


class MembershipRole(StrEnum):
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class LeagueVisibility(StrEnum):
    PRIVATE = "PRIVATE"
    PUBLIC = "PUBLIC"
