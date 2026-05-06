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
  ContestStatus,
  ContestType,
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
  ParticipantStatus,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
  TimeFormat,
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
  createdBy: string;
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

/** Configured sport definition known to the platform. */
export interface SportConfig extends DomainEntity {
  name: Sport;
  participantType: ParticipantType;
}

/** Season metadata for a given sport. */
export interface Season extends DomainEntity {
  sportId: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
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
  position?: string;
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
  contestType: ContestType;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
  sport?: Sport;
  isExclusive: boolean;

  // Timing
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
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

export type TierAssignmentMode = 'AUTO_RANKING' | 'AUTO_PRICE' | 'AUTO_ODDS' | 'AUTO_SEED' | 'MANUAL';

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
  status: 'ACTIVE' | 'INACTIVE';
  tiebreakerValue?: number | null;
  totalScore: number;
  standingsPosition?: number;
  isEliminated: boolean;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface ContestEntryPick extends DomainEntity {
  entryId: string;
  sportEventParticipantId: string;
  contestType: ContestType;
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

// --- Standings & Results ---

export interface ContestHistoryResult extends DomainEntity {
  contestId: string;
  entryId: string;
  finalRank: number;
  totalScore: number;
  prizeAmount?: number;

  // Denormalised history fields (immutable after contest close)
  leagueId?: string;
  leagueMembershipId?: string;
  contestName?: string;
  contestType?: string;
  sport?: string;
  numEntries?: number;
  startedAt?: Date;
  endedAt?: Date;
  isWinner: boolean;
  isPaidPosition: boolean;
  entryFeePaid?: number;
  prizeLabel?: string;
  netResult?: number;
  percentileRank?: number;
  pointsBehindWinner?: number;
  pointsBehindNext?: number;
  draftPosition?: number;
  rosterSnapshotId?: string;
  closedAt?: Date;
}

// --- Contest History ---

export interface RosterHistoryEntry {
  participantId: string;
  participantName: string;
  tier?: number;
  salaryCost?: number;
  draftRound?: number;
  draftPick?: number;
}

/** Tiered contest selections captured for history playback. */
export interface TierSelection {
  tierId: string;
  tierName: string;
  participantIds: string[];
}

/** Prize or payout record associated with a historical contest result. */
export interface ContestHistoryPayout {
  id: string;
  contestId: string;
  leagueId: string;
  entryId: string;
  leagueMembershipId: string;
  prizeType: 'FINAL_STANDING' | 'INTERMEDIATE' | 'BONUS';
  prizeLabel: string;
  prizeRank?: number;
  amount: number;
  isCash: boolean;
  nonCashDescription?: string;
  paidAt?: Date;
  acknowledgedByMember: boolean;
  createdAt: Date;
}

/** Full historical summary of a completed contest. */
export interface ContestHistorySummary {
  contestId: string;
  contestName: string;
  sport: string;
  contestType: string;
  season?: string;
  startedAt?: Date;
  endedAt?: Date;
  numEntries: number;
  finalStandings: ContestHistoryResult[];
  payouts: ContestHistoryPayout[];
  highlights: ContestHighlights;
}

/** Headline contest-history highlight metrics. */
export interface ContestHighlights {
  highestScore?: { entryId: string; entryName: string; score: number };
  lowestScore?: { entryId: string; entryName: string; score: number };
  closestFinish?: { margin: number };
  winnerMargin?: number;
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

// --- Admin & Platform Operations ---

export type AdminPermission =
  | 'user.view' | 'user.edit' | 'user.reset_password' | 'user.force_logout' | 'user.merge'
  | 'contest.view' | 'contest.override' | 'contest.recalculate' | 'contest.close'
  | 'sportsdata.view' | 'sportsdata.configure' | 'sportsdata.re_ingest'
  | 'platform.health' | 'platform.migrations'
  | 'audit.view';

/** Audit log entry written for an administrative action. */
export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

/** Runtime record for a platform migration initiated from admin tooling. */
export interface MigrationRun {
  id: string;
  migrationId: string;
  status: string;
  options: Record<string, unknown>;
  progress: Record<string, unknown>;
  errors: Record<string, unknown>[];
  startedAt: Date;
  completedAt?: Date;
  startedById: string;
}

// --- Commissioner Dashboard ---

export interface ActionItem extends DomainEntity {
  leagueId: string;
  contestId?: string;
  title: string;
  description?: string;
  actionUrl?: string;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface CommissionerDashboard {
  league: League;
  actionItems: ActionItem[];
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
  eventType: 'DRAFT_START' | 'CONTEST_START' | 'CONTEST_END' | 'LOCK_TIME';
}
