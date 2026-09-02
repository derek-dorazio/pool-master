import type {
  ContestStatus,
  ContestFormat,
  GolfCategoryKey,
  GolfContestConfigMode,
  GolfCutRuleType,
  GolfDisplayScoring,
  GolfParticipantInactiveReason,
  GolfPlayoffHandling,
  GolfTiebreakerType,
  ScoringEngine,
  SelectionType,
  Sport,
  SportEventStatus,
} from './enums';
import type {
  AggregationDefinitionId,
  ParticipantScoringDefinitionId,
} from './contest-scoring';
import type { DomainEntity } from './types';

export interface GolfFixedCutRule {
  type: GolfCutRuleType;
  fixedScore: number;
}

export interface GolfTiebreakerRule {
  type: GolfTiebreakerType;
}

export interface GolfContestTierDefinition {
  tierKey: string;
  label: string;
  pickCount: number;
  startPosition: number;
  endPosition: number | null;
}

export interface PersistedGolfContestTierDefinition extends GolfContestTierDefinition {
  tierId?: string;
  tierName?: string;
  tierNumber?: number;
  picksFromTier?: number;
  participantIds?: string[];
}

export interface GolfCategoryDefinition {
  categoryKey: GolfCategoryKey;
  label: string;
  pickCount: number;
}

/**
 * Shrunk per plans/124 §4.6/§4.6a: tiers and price are event-owned data
 * (SportEventGolfTier/SportEventParticipantGolfValuation via
 * golf-tier-service.getEffectiveTiersForContest), never a per-contest
 * override, so tierSource/tierGeneration/tiers all drop. cutRule/
 * playoffHandling/displayScoring/tiebreaker each had exactly one possible
 * value and zero real reads downstream — dropped as dead configuration, not
 * simplified. rosterSize/countedScores are the one thing that's genuinely a
 * per-pool rule (two commissioners on the same tournament can legitimately
 * pick different roster sizes).
 */
export interface GolfTieredContestConfig {
  mode: 'GOLF_TIERED';
  rosterSize: number;
  countedScores: number;
}

export interface GolfCategoryContestConfig {
  mode: 'GOLF_CATEGORY_PICKS';
  categories: GolfCategoryDefinition[];
  cutRule: GolfFixedCutRule;
  playoffHandling: GolfPlayoffHandling;
  displayScoring: GolfDisplayScoring;
  tiebreaker: GolfTiebreakerRule;
}

export type GolfContestConfig =
  | GolfTieredContestConfig
  | GolfCategoryContestConfig;

export type SportEventReadinessStatus =
  | 'NOT_RELEASED'
  | 'PENDING_FIELD'
  | 'CONTEST_ELIGIBLE'
  | 'FIELD_LOCKED';

export type SportEventReadinessReason =
  | 'EVENT_NOT_RELEASED'
  | 'FIELD_NOT_LOADED'
  | 'FIELD_LOCKED';

/** Imported real-world event augmented with PoolMaster operational timing. */
export interface SportEvent extends DomainEntity {
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  status: SportEventStatus;
  rounds?: number;
  participantCount?: number;
  fieldLocked: boolean;
  releaseAt: Date;
  fieldLocksAt: Date;
  metadata: Record<string, unknown>;
}

/** Seeded timing policy used to resolve event release/field-lock datetimes. */
export interface ContestTimingPolicy extends DomainEntity {
  sport: Sport;
  eventType?: string | null;
  contestFormat?: ContestFormat | null;
  releaseRule: string;
  fieldLockRule: string;
  isDefault: boolean;
  active: boolean;
}

/**
 * Join record linking a provider event to a normalized participant. The
 * Per-event participant state for a normalized event field. World ranking is
 * copied from the latest provider-scoped global ranking snapshot during event
 * hydration; odds and seed are event-scoped values from the event detail feed.
 */
export interface SportEventParticipant extends DomainEntity {
  sportEventId: string;
  participantId: string;
  /** Whether this golfer is currently eligible/available for this tournament. */
  isActive: boolean;
  /** Meaningful only when `isActive` is false; undefined covers "inactive, no more specific reason recorded." */
  inactiveReason?: GolfParticipantInactiveReason;
  /** Latest global world-ranking snapshot copied onto this event participant. */
  worldRanking?: number;
  /** Event-scoped implied odds-to-win snapshot (decimal). */
  oddsToWin?: number;
  /** Event-relative seed number (e.g., NCAA tournament seed). */
  seedNumber?: number;
  metadata: Record<string, unknown>;
}

/** Raw provider payload captured for a sport-event participant synchronization. */
export interface SportEventParticipantSourceData extends DomainEntity {
  sportEventParticipantId: string;
  providerId: string;
  externalId: string;
  rawPayload: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  receivedAt: Date;
}

/** Commissioner-managed contest configuration persisted alongside the contest. */
export interface ContestConfiguration extends DomainEntity {
  contestId: string;
  templateId?: string | null;
  templateVersion?: number | null;
  selectionType: SelectionType;
  configMode?: GolfContestConfigMode | null;
  configJson?: GolfContestConfig;
  rounds?: number;
  timePerPickSeconds?: number;
  autoPickPolicy?: string;
  locksAt?: Date;
  minimumEntries?: number;
  maxEntriesPerSquad?: number | null;
  totalPrizePoolAmount?: number | null;

  // Legacy support fields retained temporarily for read paths not yet narrowed.
  roundValues?: number[];
  startRound?: string;
  tierConfig?: PersistedGolfContestTierDefinition[];
  budget?: number;
  pricingMethod?: string;
  pickCount?: number;
  isExclusive?: boolean;
  picksPerPeriod?: number;
  rosterSize?: number;
}

/** Seeded reusable contest template selected during commissioner create flow. */
export interface ContestConfigTemplate extends DomainEntity {
  sport: Sport;
  eventType?: string | null;
  contestFormat: ContestFormat;
  configMode: GolfContestConfigMode;
  templateKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  configJson: GolfContestConfig;
  schemaVersion: number;
}

/** Participant scoring rule attached to a managed contest configuration. */
export interface ParticipantContestScoringRule extends DomainEntity {
  contestConfigurationId: string;
  participantScoringDefinitionId: ParticipantScoringDefinitionId;
  sortOrder: number;
  config: Record<string, unknown>;
  active: boolean;
}

/** Entry aggregation rule that converts participant points into entry points. */
export interface ContestEntryAggregationRule extends DomainEntity {
  contestConfigurationId: string;
  aggregationDefinitionId: AggregationDefinitionId;
  config: Record<string, unknown>;
  active: boolean;
}

/** Prize definition attached to a contest configuration. */
export interface ContestPrizeDefinition extends DomainEntity {
  contestConfigurationId: string;
  prizeDefinitionId: string;
  displayName: string;
  sortOrder: number;
  ruleConfig: Record<string, unknown>;
  payoutType?: 'FIXED_AMOUNT' | 'PERCENTAGE';
  amount?: number;
  percentage?: number;
  active: boolean;
}

/** Condensed contest summary used by contest-management flows. */
export interface ContestCoreSummary extends DomainEntity {
  leagueId: string;
  sportEventId: string;
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
}
