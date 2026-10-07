/**
 * Domain types — TypeScript interfaces for the full PoolMaster domain model.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active refactor plans.
 * The current backend is centered on roster-based contests and core league/
 * contest operations; deferred mechanics remain in the shared type catalog
 * until they are rebuilt or removed.
 */

import type {
  AuthProvider,
  ContestEntryStatus,
  ContestStatus,
  ContestFormat,
  DateFormat,
  DraftStatus,
  InjuryStatusCode,
  InvitationStatus,
  JoinPolicy,
  InviteType,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
  MappingConfidence,
  ProviderSyncRunStatus,
  ParticipantStatus,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
  SportCategory,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
  TierAssignmentMode,
  TimeFormat,
  TournamentFormat,
} from './enums';

// --- Base ---

export interface DomainEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Identity ---

/** Core user-account record used across PoolMaster services. */
export interface User extends DomainEntity {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  authProvider?: AuthProvider;
  authId?: string;
  isRootAdmin?: boolean;
  timezone?: string;
  locale?: string;
  timeFormat?: TimeFormat;
  dateFormat?: DateFormat;
}

// --- League ---

/** Core league record that powers league-home, invites, and commissioner management. */
export interface League extends DomainEntity {
  leagueCode: string;
  name: string;
  description?: string;
  isActive: boolean;
  iconKey: LeagueIconKey;
  joinPolicy: JoinPolicy;
}

/** User membership within a league. */
export interface LeagueMembership extends DomainEntity {
  leagueId: string;
  userId: string;
  role: LeagueRole;
  status: LeagueMembershipStatus;
  joinedAt: Date;
}

/** Team-like grouping owned inside a league for contests that need squad context. */
export interface Squad extends DomainEntity {
  leagueId: string;
  createdBy: string;
  name: string;
  iconKey: TeamIconKey;
  isActive: boolean;
}

/** User membership within a squad. */
export interface SquadMembership extends DomainEntity {
  squadId: string;
  leagueId: string;
  userId: string;
  status: SquadMembershipStatus;
  joinedAt: Date;
}

/** Email-driven invitation to add or replace a team owner inside a league. */
export interface SquadOwnerInvitation extends DomainEntity {
  leagueId: string;
  squadId: string;
  email: string;
  inviteCode: string;
  status: SquadOwnerInvitationStatus;
  invitedBy: string;
  expiresAt?: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
  replacementForUserId?: string;
}

/** Direct email or link-based invitation into a league. */
export interface LeagueInvitation extends DomainEntity {
  leagueId: string;
  email?: string;
  inviteCode: string;
  inviteType: InviteType;
  status: InvitationStatus;
  maxUses: number;
  currentUses: number;
  invitedBy: string;
  expiresAt?: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
}

// --- Sport & Participant ---

/**
 * Configured sport definition known to the platform.
 *
 * Per plans/117 §4.1, the Sport entity now carries `category` and
 * `tournamentFormat` from pool-master-rop.78.4. `category` drives
 * per-category detail-table dispatch in scoring; `tournamentFormat`
 * drives the validity matrix in plans/117 §9.
 *
 * The `name` field continues to hold the legacy enum-style string
 * (`Sport.GOLF` etc.) until a future slice broadens to granular
 * tournament-level names ("PGA Masters", "NCAA Tournament 2026").
 */
export interface SportConfig extends DomainEntity {
  name: Sport;
  participantType: ParticipantType;
  category: SportCategory;
  tournamentFormat: TournamentFormat;
}


/** Normalized participant record imported from one or more data providers. */
export interface Participant extends DomainEntity {
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId?: string;

  // Enriched profile fields
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  /** Playing role ("GOLFER", "QB"), not a rank — `position` means rank on the standing tables. */
  role?: string;
  teamAffiliation?: string;
  status: ParticipantStatus;
  injuryStatus: InjuryStatus;
  photoUrl?: string;
  photoLastUpdated?: Date;
  externalIds: Record<string, string>;
}

/** Injury or availability status captured for a participant. */
export interface InjuryStatus {
  status: InjuryStatusCode;
  detail?: string;
  expectedReturn?: Date;
  updatedAt?: Date;
  source?: string;
}

/** Mapping between a provider participant and an internal participant. */
export interface ParticipantProviderMapping extends DomainEntity {
  participantId: string;
  providerId: string;
  externalId: string;
  confidence: MappingConfidence;
  mappedAt: Date;
}

// --- Contest ---

/** Core contest record representing a pool or competition within a league. */
export interface Contest extends DomainEntity {
  leagueId: string;
  sportEventId?: string;
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
  sport?: Sport;
  isExclusive: boolean;

  // Timing
  startsAt?: Date;
  endsAt?: Date;
  scoringStopsOnElimination: boolean;
}

/** Tier definition used for tiered contest-selection modes. */
export interface TierDefinition {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  rankingRange?: [number, number];
  priceRange?: [number, number];
  maxParticipants?: number;
  participantIds: string[];
}

// --- Pricing & Tier Configuration ---

export interface PricingConfig {
  sport: Sport;
  contestId?: string;
  totalBudget: number;
  minPrice: number;
  maxPrice: number;
  priceIncrement: number;
  rankingWeight: number;
  formWeight: number;
  oddsWeight: number;
  seedWeight: number;
  manualOverrides: PriceOverride[];
}

/** Manual pricing override applied to a participant. */
export interface PriceOverride {
  participantId: string;
  overridePrice: number;
  reason: string;
  setBy: string;
  setAt: Date;
}

/** Tier assignment configuration for contests that use tier-based selection. */
export interface TierConfig {
  contestId: string;
  sport: Sport;
  assignmentMode: TierAssignmentMode;
  tiers: TierDefinition[];
}

// --- Entry & Picks ---

/**
 * An entry in a contest — one per league member per contest.
 * For roster-based contests, this owns the selected roster.
 */
export interface ContestEntry extends DomainEntity {
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  status: ContestEntryStatus;
  tiebreakerValue?: number | null;
  isEliminated: boolean;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface ContestEntryPick extends DomainEntity {
  entryId: string;
  sportEventParticipantId: string;
  contestFormat: ContestFormat;
  period?: number;
  slot?: number;
  tier?: string;
  cost?: number;
  isAutoPicked: boolean;
  draftRound?: number;
  draftPickNumber?: number;
  pickedAt: Date;
}

// --- Draft Session (Snake Draft only) ---

export interface DraftSession extends DomainEntity {
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId?: string;
  startedAt?: Date;
  currentTurnStartedAt?: Date;
}

/** Historical record of a draft pick. */
export interface DraftPickHistory extends DomainEntity {
  draftSessionId: string;
  pickId: string;
  entryId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  autoPicked: boolean;
}

// --- Payout Configuration ---

export interface PayoutConfig {
  entryFee?: number;
  prizePool?: number;
  payoutStructure: PayoutSlot[];
  intermediatePrizes: IntermediatePrize[];
}

/** Single payout slot for final standings. */
export interface PayoutSlot {
  rank: number;
  percentage: number;
  fixedAmount?: number;
}

/** Intermediate prize configured outside the final standings table. */
export interface IntermediatePrize {
  name: string;
  description?: string;
  amount?: number;
  percentage?: number;
}

// --- Platform & Ingestion ---

/**
 * One feed's sync against a provider — the ingestion history. `eventId` is the provider's
 * event identifier when the run was narrowed to one event, null for a whole-sport run.
 * `payload` is the ledger's record of the run: request, provider operation, stats,
 * outcome, and the serialized ingestion job once it completes.
 */
export interface ProviderSyncRun {
  id: string;
  providerId: string;
  sport: Sport;
  eventId: string | null;
  status: ProviderSyncRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payload: Record<string, unknown>;
}

/** A runtime-tunable platform setting, stored as one JSON document per key. */
export interface PlatformRuntimeConfig extends DomainEntity {
  configKey: string;
  configJson: unknown;
  updatedById: string | null;
}

/** One saved change to a platform setting (#450). Append-only. */
export interface PlatformRuntimeConfigChange {
  id: string;
  configKey: string;
  /** Null when the save created the setting's first stored value. */
  previousJson: unknown;
  newJson: unknown;
  changedById: string | null;
  changedAt: Date;
}

// --- Commissioner Dashboard ---

export interface CommissionerDashboard {
  league: League;
  contests: Contest[];
  memberCount: number;
  pendingInvites: number;
  recentMemberActivity: MemberActivityEvent[];
  upcomingEvents: UpcomingEvent[];
}

/** Member activity event surfaced in commissioner dashboards. */
export interface MemberActivityEvent {
  userId: string;
  firstName?: string;
  lastName?: string;
  action: string;
  timestamp: Date;
}

/** Upcoming scheduled item surfaced in commissioner dashboards. */
export interface UpcomingEvent {
  contestId?: string;
  title: string;
  date: Date;
  eventType: 'DRAFT_START' | 'CONTEST_START' | 'CONTEST_END';
}
