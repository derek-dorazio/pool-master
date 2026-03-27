/**
 * Domain types — TypeScript interfaces for the full PoolMaster domain model.
 *
 * Aligned to poolmaster-contest-structures-v4.md.
 * Three contest categories: squad selection pools, survivor/knockout pools, pick'em/bracket.
 * No roster management, waivers, trades, or DFS mechanics.
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
  PoolType,
  InviteType,
  LeagueRole,
  LeagueVisibility,
  MappingConfidence,
  ParticipantStatus,
  ParticipantType,
  PricingMethod,
  ScoringEngine,
  SelectionType,
  Sport,
  SurvivorStyle,
  TierAssignmentMethod,
  WeekDay,
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
  defaultLocale: string;
  defaultTimezone: string;
  defaultCurrency: string;
}

export interface User extends DomainEntity {
  email: string;
  displayName: string;
  authProvider?: string;
  authId?: string;
  tenantId?: string;
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
  permissions: CommissionerPermission[];
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
  defaultScoringTemplateId?: string;
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
  tenantId: string;
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
  seasonId: string;
  name: string;
  status: ContestStatus;
  contestType: ContestType;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
  isExclusive: boolean;

  // Timing
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;

  // Scoring behaviour
  scoringStopsOnElimination: boolean;
  scoringRules: ScoringRulesConfig;

  // Links
  selectionConfigId?: string;
}

/**
 * Structured scoring configuration — stored as JSONB per contest.
 * Only the fields relevant to the contest's scoringEngine are populated.
 */
export interface ScoringRulesConfig {
  // Advancement scoring (team wins / series wins)
  roundValues?: number[];                      // [1, 2, 4, 8] — multiplier per playoff round

  // Stat accumulation scoring (player personal stats)
  statWeights?: Record<string, number>;        // { goal: 6, assist: 3, cleanSheet: 4 }

  // Stroke play (golf)
  missedCutPenalty?: number;                   // e.g. 80 per missed round
  bestBallN?: number;                          // pick 6, use best 4

  // Position scoring (horse racing)
  positionPoints?: Record<number, number>;     // { 1: 100, 2: 60, 3: 40 }

  // Bracket / pick'em
  roundMultipliers?: number[];                 // points per correct pick per round
  seriesLengthBonus?: number;                  // bonus for predicting series length
  correctScoreBonus?: number;                  // bonus for exact score prediction
  groupStagePredictions?: boolean;             // soccer: includes group stage W/D/L

  // Fight result (UFC)
  resultWeights?: Record<string, number>;      // { ko_tko: 10, submission: 9, decision: 7 }
  bonusWeights?: Record<string, number>;       // { round1_finish: 2, round1_ko: 3 }

  // Confidence weighting (optional for pick'em)
  confidenceWeighted?: boolean;

  // Tiebreaker
  tiebreakerRule?: string;
}

// --- Selection Configuration ---

/**
 * How participants make their picks for a contest.
 * Replaces the old DraftConfiguration — covers drafts, tiered picks, budget picks,
 * survivor picks, and bracket predictions.
 */
export interface SelectionConfig extends DomainEntity {
  contestId: string;
  selectionType: SelectionType;

  // --- Snake Draft config ---
  draftMode?: DraftMode;
  rounds?: number;
  timePerPickSeconds?: number;
  autoPickPolicy?: string;

  // --- Tiered Pick config ---
  tierConfig?: TierDefinition[];
  tierAssignmentMethod?: TierAssignmentMethod;

  // --- Budget Pick config ---
  budget?: number;
  pricingMethod?: PricingMethod;
  rosterSize?: number;

  // --- Open Selection config ---
  pickCount?: number;                          // "Pick 8" — how many from the full field

  // --- Survivor config ---
  survivorStyle?: SurvivorStyle;
  picksPerPeriod?: number;                     // typically 1; 2 = Double Pick
  oneEntityPerSeason?: boolean;                // each team/player usable only once
  strikesBeforeElimination?: number;            // 0 = instant elimination
  buybacksAllowed?: boolean;

  // --- Bracket / Pick'em config ---
  roundValues?: number[];                      // bracket: points per correct pick per round
  startRound?: string;                         // e.g. "SWEET_16", "QUARTERFINALS"

  // --- Shared ---
  isExclusive: boolean;
  bestBallN?: number;                          // golf: use best N of submitted picks
  missedCutPenalty?: number;
  captainSlot?: boolean;                       // optional 2x multiplier on one pick
  captainMultiplier?: number;
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
  manualOverrides: PriceOverride[];
}

export interface PriceOverride {
  participantId: string;
  overridePrice: number;
  reason: string;
  setBy: string;
  setAt: Date;
}

export type TierAssignmentMode = 'AUTO_RANKING' | 'AUTO_PRICE' | 'MANUAL';

export interface TierConfig {
  contestId: string;
  sport: Sport;
  assignmentMode: TierAssignmentMode;
  tiers: TierDefinition[];
}

// --- Contest Pool ---

export interface ContestPool extends DomainEntity {
  contestId: string;
  sport: Sport;
  eventId?: string;
  poolType: PoolType;
  config: ContestPoolConfig;
  excludedParticipantIds: string[];
  poolLocked: boolean;
  poolLockedAt?: Date;
}

export interface ContestPoolConfig {
  // EVENT_FIELD config
  includeAlternates?: boolean;
  autoUpdateOnFieldChange?: boolean;

  // RANKING_CUTOFF config
  rankingType?: string;
  maxRank?: number;

  // CUSTOM config
  customParticipantIds?: string[];
}

export interface ContestParticipantPool extends DomainEntity {
  poolId: string;
  contestId: string;
  participantId: string;
  cost?: number;
  tier?: string;
  tierAssignmentMethod?: TierAssignmentMethod;
  ranking?: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

// --- Entry & Picks ---

/**
 * An entry in a contest — one per league member per contest.
 * For squad contests, this owns the drafted/picked roster.
 * For survivor/pick'em, this owns the submitted picks.
 */
export interface ContestEntry extends DomainEntity {
  contestId: string;
  leagueMembershipId: string;
  name: string;
  totalScore: number;
  rank?: number;
  isEliminated: boolean;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface RosterPick extends DomainEntity {
  entryId: string;
  participantId: string;
  draftRound?: number;
  draftPickNumber?: number;
  pickedAt: Date;
  autoPicked: boolean;
}

/**
 * A single pick within a survivor or pick'em contest.
 * One per entry per period (week, round, day).
 */
export interface ContestPick extends DomainEntity {
  entryId: string;
  contestId: string;
  participantId: string;
  period: number;
  periodLabel?: string;                        // "Week 5", "Round 2", "Quarterfinals"
  pickedAt: Date;
  isCorrect?: boolean;                         // resolved after period ends
  confidenceWeight?: number;                   // for confidence-weighted pick'em
  multiplier?: number;                         // for multiplier survivor (NCAAF-5)
  isReplacement?: boolean;                     // for buyback/hold'em replacement picks
}

/**
 * A bracket prediction — all round predictions submitted at once.
 */
export interface BracketPrediction extends DomainEntity {
  entryId: string;
  contestId: string;
  predictions: BracketMatchPrediction[];
  submittedAt: Date;
  tiebreakerValue?: number;                    // e.g. predicted total score of final
}

export interface BracketMatchPrediction {
  roundNumber: number;
  matchNumber: number;
  predictedWinnerId: string;
  predictedSeriesLength?: number;              // for NHL/NBA series
  predictedScore?: string;                     // for soccer exact score
  isCorrect?: boolean;
}

// --- Draft Session (Snake Draft only) ---

export interface DraftSession extends DomainEntity {
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId?: string;
  startedAt?: Date;
  pickDeadline?: Date;
}

export interface DraftPick extends DomainEntity {
  draftSessionId: string;
  entryId: string;
  participantId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  pickedAt: Date;
  autoPicked: boolean;
}

// --- Standings & Results ---

export interface ContestStanding extends DomainEntity {
  contestId: string;
  entryId: string;
  rank: number;
  totalScore: number;
  lastUpdatedAt: Date;
}

export interface ContestResult extends DomainEntity {
  contestId: string;
  entryId: string;
  finalRank: number;
  totalScore: number;
  prizeAmount?: number;

  // Denormalised history fields (immutable after contest close)
  leagueId?: string;
  seasonId?: string;
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

export interface TeamRosterHistory {
  id: string;
  contestId: string;
  entryId: string;
  lockedAt: Date;
  roster: RosterHistoryEntry[];
  draftBudgetUsed?: number;
  tiersSelected?: TierSelection[];
}

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

export interface PayoutHistoryRecord {
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
  finalStandings: ContestResult[];
  payouts: PayoutHistoryRecord[];
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

export type AdminRole = 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'DATA_OPS' | 'VIEWER';

export type AdminPermission =
  | 'tenant.view' | 'tenant.edit' | 'tenant.suspend' | 'tenant.delete' | 'tenant.impersonate'
  | 'user.view' | 'user.edit' | 'user.reset_password' | 'user.force_logout' | 'user.merge'
  | 'contest.view' | 'contest.override' | 'contest.recalculate' | 'contest.close'
  | 'sportsdata.view' | 'sportsdata.configure' | 'sportsdata.re_ingest'
  | 'flags.view' | 'flags.edit'
  | 'platform.health' | 'platform.announcements' | 'platform.migrations'
  | 'audit.view';

export interface AdminUser extends DomainEntity {
  email: string;
  name: string;
  role: AdminRole;
  permissions: AdminPermission[];
  ssoProviderId?: string;
  mfaEnabled: boolean;
  mfaSecret?: string;
  lastLoginAt?: Date;
  isActive: boolean;
}

export interface AdminAuditEntry {
  id: string;
  adminUserId: string;
  adminUserEmail: string;
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

export interface FeatureFlag extends DomainEntity {
  key: string;
  name: string;
  description?: string;
  flagType: string;
  enabledGlobally: boolean;
  rolloutPercentage?: number;
  owner?: string;
  updatedById?: string;
}

export interface FeatureFlagOverride {
  id: string;
  flagId: string;
  tenantId: string;
  enabled: boolean;
  reason?: string;
  createdAt: Date;
  createdById?: string;
}

export interface GlobalAnnouncement {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl?: string;
  linkText?: string;
  severity: string;
  dismissable: boolean;
  target: string;
  targetTenantIds: string[];
  startsAt: Date;
  endsAt?: Date;
  isActive: boolean;
  createdById: string;
  createdAt: Date;
}

export interface ImpersonationSession {
  id: string;
  adminUserId: string;
  tenantId: string;
  startedAt: Date;
  endedAt?: Date;
  isActive: boolean;
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

// --- Contest Template ---

export interface ContestTemplate extends DomainEntity {
  leagueId: string;
  createdBy: string;
  name: string;
  description?: string;
  sport: Sport;
  contestType: ContestType;
  draftConfig: Record<string, unknown>;
  scoringConfig: Record<string, unknown>;
  payoutConfig: Record<string, unknown>;
  poolConfig: Record<string, unknown>;
  sharedWithTenant: boolean;
  isPlatformTemplate: boolean;
  timesUsed: number;
  lastUsedAt?: Date;
}
