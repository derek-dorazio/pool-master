/** Enumerations used across the PoolMaster domain. */

export const Sport = {
  GOLF: 'GOLF',
  NFL: 'NFL',
  NBA: 'NBA',
  F1: 'F1',
  NASCAR: 'NASCAR',
  NCAA_BASKETBALL: 'NCAA_BASKETBALL',
  TENNIS: 'TENNIS',
  HORSE_RACING: 'HORSE_RACING',
  EPL: 'EPL',
  NHL: 'NHL',
  MLB: 'MLB',
} as const;
export type Sport = (typeof Sport)[keyof typeof Sport];

export const ParticipantType = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const;
export type ParticipantType = (typeof ParticipantType)[keyof typeof ParticipantType];

export const ContestType = {
  SINGLE_EVENT: 'SINGLE_EVENT',
  SEASON_LONG: 'SEASON_LONG',
  BRACKET: 'BRACKET',
} as const;
export type ContestType = (typeof ContestType)[keyof typeof ContestType];

export const ScoringType = {
  CUMULATIVE: 'CUMULATIVE',
  KNOCKOUT: 'KNOCKOUT',
  BRACKET: 'BRACKET',
  STROKE_PLAY: 'STROKE_PLAY',
  POSITION: 'POSITION',
  ROTISSERIE: 'ROTISSERIE',
  HEAD_TO_HEAD: 'HEAD_TO_HEAD',
} as const;
export type ScoringType = (typeof ScoringType)[keyof typeof ScoringType];

export const DraftType = {
  SNAKE: 'SNAKE',
  SALARY_CAP: 'SALARY_CAP',
  TIERED: 'TIERED',
} as const;
export type DraftType = (typeof DraftType)[keyof typeof DraftType];

export const DraftMode = {
  LIVE: 'LIVE',
  ASYNC: 'ASYNC',
} as const;
export type DraftMode = (typeof DraftMode)[keyof typeof DraftMode];

export const ContestStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  DRAFTING: 'DRAFTING',
  LOCKED: 'LOCKED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContestStatus = (typeof ContestStatus)[keyof typeof ContestStatus];

export const DraftStatus = {
  PENDING: 'PENDING',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
} as const;
export type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus];

export const LeagueRole = {
  OWNER: 'OWNER',
  COMMISSIONER: 'COMMISSIONER',
  MANAGER: 'MANAGER',
  VIEWER: 'VIEWER',
} as const;
export type LeagueRole = (typeof LeagueRole)[keyof typeof LeagueRole];

export const LeagueVisibility = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
} as const;
export type LeagueVisibility = (typeof LeagueVisibility)[keyof typeof LeagueVisibility];
