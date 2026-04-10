/**
 * Domain types — TypeScript interfaces for the full PoolMaster domain model.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active refactor plans.
 * The current backend is centered on roster-based contests and core league/
 * contest operations; deferred mechanics remain in the shared type catalog
 * until they are rebuilt or removed.
 */

import type {
  CommissionerPermission,
  ContestStatus,
  ContestType,
  DraftMode,
  DraftStatus,
  FormTrend,
  InjuryStatusCode,
  InvitationStatus,
  InvitePolicy,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
  LeagueVisibility,
  MappingConfidence,
  ParticipantStatus,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
  SquadMembershipStatus,
  SquadStatus,
  WeekDay,
} from './enums';

// --- Base ---

export interface DomainEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Identity ---

export interface User extends DomainEntity {
  email: string;
  displayName: string;
  authProvider?: string;
  authId?: string;
  isRootAdmin?: boolean;
  timezone?: string;
  locale?: string;
  timeFormat?: '12H' | '24H';
  dateFormat?: 'MDY' | 'DMY' | 'YMD';
}

// --- User Locale Preferences ---

export interface UserLocalePreference {
  userId: string;
  language: string;
  timezone?: string;
  timeFormat: '12H' | '24H';
  dateFormat: 'MDY' | 'DMY' | 'YMD';
  firstDayOfWeek: 'SUNDAY' | 'MONDAY';
  preferredCurrency?: string;
  deviceLocale?: string;
  deviceTimezone?: string;
  updatedAt: Date;
}

// --- League ---

export interface League extends DomainEntity {
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
  status: LeagueMembershipStatus;
  permissions: CommissionerPermission[];
  joinedAt: Date;
}

export interface Squad extends DomainEntity {
  leagueId: string;
  createdBy: string;
  name: string;
  iconUrl?: string;
  status: SquadStatus;
}

export interface SquadMembership extends DomainEntity {
  squadId: string;
  leagueId: string;
  userId: string;
  status: SquadMembershipStatus;
  joinedAt: Date;
}

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

export interface LeagueSettings {
  invitePolicy: InvitePolicy;
  inviteLinkCode?: string;
  allowMidSeasonJoin: boolean;
  requireApproval: boolean;
  defaultDraftType?: DraftMode;
  defaultPayoutTemplateId?: string;
  activityFeedEnabled: boolean;
  weeklyRecapEnabled: boolean;
  weeklyRecapDay: WeekDay;
  timezone: string;
  currency: string;
}

// --- Sport & Participant ---

export interface SportConfig extends DomainEntity {
  name: Sport;
  participantType: ParticipantType;
  statSchema: Record<string, unknown>;
}

export interface Season extends DomainEntity {
  sportId: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface Participant extends DomainEntity {
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId?: string;
  metadata: Record<string, unknown>;

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

export interface InjuryStatus {
  status: InjuryStatusCode;
  detail?: string;
  expectedReturn?: Date;
  updatedAt?: Date;
  source?: string;
}

export interface ParticipantSeasonRecord extends DomainEntity {
  participantId: string;
  sport: Sport;
  season: string;
  rankings: SeasonRanking[];
  budgetPrice: number;
  priceTier?: string;
  priceUpdatedAt?: Date;
  eventsEntered: number;
  eventsCompleted: number;
  wins: number;
  top5Finishes: number;
  top10Finishes: number;
  top25Finishes: number;
  seasonStats: Record<string, number>;
  formRating: number;
  formTrend: FormTrend;
  lastUpdated: Date;
}

export interface SeasonRanking {
  rankingType: string;
  rank: number;
  points?: number;
  asOfDate: Date;
}

export interface ParticipantProviderMapping extends DomainEntity {
  participantId: string;
  providerId: string;
  externalId: string;
  confidence: MappingConfidence;
  mappedAt: Date;
}

// --- Contest ---

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

export interface PriceOverride {
  participantId: string;
  overridePrice: number;
  reason: string;
  setBy: string;
  setAt: Date;
}

export type TierAssignmentMode = 'AUTO_RANKING' | 'AUTO_PRICE' | 'AUTO_ODDS' | 'AUTO_SEED' | 'MANUAL';

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
  totalScore: number;
  standingsPosition?: number;
  isEliminated: boolean;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface RosterPick extends DomainEntity {
  entryId: string;
  sportEventParticipantId: string;
  draftRound?: number;
  draftPickNumber?: number;
  pickedAt: Date;
  autoPicked: boolean;
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

export interface DraftPickHistory extends DomainEntity {
  draftSessionId: string;
  rosterPickId: string;
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

export interface TierSelection {
  tierId: string;
  tierName: string;
  participantIds: string[];
}

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

export interface PayoutSlot {
  rank: number;
  percentage: number;
  fixedAmount?: number;
}

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
  type: ActionItemType;
  priority: ActionItemPriority;
  title: string;
  description?: string;
  actionUrl?: string;
  resolved: boolean;
  resolvedAt?: Date;
}

export type ActionItemType =
  | 'DRAFT_STARTING'
  | 'PAYOUT_PENDING'
  | 'JOIN_REQUEST'
  | 'SCORE_OVERRIDE_NEEDED'
  | 'MEMBER_INACTIVE'
  | 'CONTEST_ENDING'
  | 'DATA_ISSUE';

export type ActionItemPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CommissionerDashboard {
  league: League;
  actionItems: ActionItem[];
  contests: Contest[];
  memberCount: number;
  pendingInvites: number;
  recentMemberActivity: MemberActivityEvent[];
  upcomingEvents: UpcomingEvent[];
}

export interface MemberActivityEvent {
  userId: string;
  displayName: string;
  action: string;
  timestamp: Date;
}

export interface UpcomingEvent {
  contestId?: string;
  title: string;
  date: Date;
  eventType: 'DRAFT_START' | 'CONTEST_START' | 'CONTEST_END' | 'LOCK_TIME';
}
