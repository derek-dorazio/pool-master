import type {
  ContestStatus,
  ContestType,
  GolfCategoryKey,
  GolfContestConfigMode,
  GolfCutRuleType,
  GolfDisplayScoring,
  GolfPlayoffHandling,
  GolfTiebreakerType,
  GolfTierSource,
  ScoringEngine,
  SelectionType,
  Sport,
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

export interface GolfTierGeneration {
  defaultTierSize: number;
}

export interface GolfContestTierDefinition {
  tierKey: string;
  label: string;
  pickCount: number;
  startPosition: number;
  endPosition: number | null;
}

export interface GolfCategoryDefinition {
  categoryKey: GolfCategoryKey;
  label: string;
  pickCount: number;
}

export interface GolfTieredContestConfig {
  mode: 'GOLF_TIERED';
  rosterSize: number;
  countedScores: number;
  tierSource: GolfTierSource;
  tierGeneration: GolfTierGeneration;
  tiers: GolfContestTierDefinition[];
  cutRule: GolfFixedCutRule;
  playoffHandling: GolfPlayoffHandling;
  displayScoring: GolfDisplayScoring;
  tiebreaker: GolfTiebreakerRule;
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
  status: string;
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
  contestType?: ContestType | null;
  releaseRule: string;
  fieldLockRule: string;
  isDefault: boolean;
  active: boolean;
}

/** Join record linking a provider event to a normalized participant. */
export interface SportEventParticipant extends DomainEntity {
  sportEventId: string;
  participantId: string;
  status?: string;
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

/** Derived valuation metadata used by pricing and ordering logic. */
export interface SportEventParticipantValuation extends DomainEntity {
  sportEventParticipantId: string;
  price?: number;
  tier?: string;
  orderIndex?: number;
  valuationSource: string;
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
  tierConfig?: GolfContestTierDefinition[];
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
  contestType: ContestType;
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

/** Aggregate participant score record for a contest entry. */
export interface ContestEntryParticipantScore extends DomainEntity {
  entryId: string;
  rosterPickId: string;
  pointsEarned: number;
}

/** Fine-grained scoring-event record that explains part of a participant score. */
export interface ContestEntryParticipantScoreEvent extends DomainEntity {
  contestEntryParticipantScoreId: string;
  participantContestScoringRuleId: string;
  points: number;
  detailsJson: Record<string, unknown>;
}

/** Prize award issued to a contest entry after calculation or settlement. */
export interface ContestEntryPrizeAward extends DomainEntity {
  entryId: string;
  contestPrizeDefinitionId: string;
  prizeDefinitionId?: string;
  displayName: string;
  amount?: number;
  percentage?: number;
  awardedAt: Date;
}

/** Condensed contest summary used by contest-management flows. */
export interface ContestCoreSummary extends DomainEntity {
  leagueId: string;
  sportEventId: string;
  name: string;
  status: ContestStatus;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
}
