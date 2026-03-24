/** Domain types — TypeScript interfaces for the full PoolMaster domain model. */

import type {
  ContestStatus,
  ContestType,
  DraftMode,
  DraftStatus,
  DraftType,
  LeagueRole,
  LeagueVisibility,
  ParticipantType,
  ScoringType,
  Sport,
} from './enums';

// --- Base ---

export interface DomainEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Tenant & Identity ---

export interface Tenant extends DomainEntity {
  name: string;
  slug: string;
  planTier: string;
  settings: Record<string, unknown>;
}

export interface User extends DomainEntity {
  email: string;
  displayName: string;
  authProvider?: string;
  authId?: string;
  tenantId?: string;
}

// --- League ---

export interface League extends DomainEntity {
  tenantId: string;
  name: string;
  description?: string;
  createdBy: string;
  visibility: LeagueVisibility;
  maxMembers: number;
  settings: Record<string, unknown>;
}

export interface LeagueMembership extends DomainEntity {
  leagueId: string;
  userId: string;
  role: LeagueRole;
  joinedAt: Date;
}

// --- Sport & Participant ---

export interface SportConfig extends DomainEntity {
  name: Sport;
  participantType: ParticipantType;
  statSchema: Record<string, unknown>;
}

export interface Season extends DomainEntity {
  sportId: string;
  tenantId: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface Participant extends DomainEntity {
  sportId: string;
  name: string;
  externalId?: string;
  metadata: Record<string, unknown>;
}

// --- Contest ---

export interface DraftConfiguration extends DomainEntity {
  draftType: DraftType;
  draftMode: DraftMode;
  rounds: number;
  timePerPickSeconds: number;
  autoPickPolicy: string;
  budget?: number;
  tierConfig?: Record<string, unknown>;
  isExclusive: boolean;
}

export interface Contest extends DomainEntity {
  leagueId: string;
  seasonId: string;
  name: string;
  status: ContestStatus;
  contestType: ContestType;
  scoringType: ScoringType;
  draftConfigId?: string;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  rulesConfig: Record<string, unknown>;
}

export interface ContestParticipantPool extends DomainEntity {
  contestId: string;
  participantId: string;
  cost?: number;
  tier?: string;
  isAvailable: boolean;
}

// --- Team & Roster ---

export interface Team extends DomainEntity {
  contestId: string;
  leagueMembershipId: string;
  name: string;
}

export interface TeamRoster extends DomainEntity {
  teamId: string;
  participantId: string;
  draftedAt: Date;
  draftRound: number;
  draftPickNumber: number;
  isActive: boolean;
}

// --- Draft ---

export interface DraftSession extends DomainEntity {
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentTeamId?: string;
  startedAt?: Date;
  pickDeadline?: Date;
}

export interface DraftPick extends DomainEntity {
  draftSessionId: string;
  teamId: string;
  participantId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  pickedAt: Date;
  autoPicked: boolean;
}
