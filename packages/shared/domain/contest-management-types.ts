import type { ContestStatus, SelectionType, ScoringEngine } from './enums';
import type { AggregationDefinitionId, ParticipantScoringDefinitionId } from './contest-scoring';
import type { DomainEntity } from './types';

/** Tier definition persisted inside a contest configuration for tiered contests. */
export interface ContestConfigurationTier {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
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
  selectionType: SelectionType;
  rounds?: number;
  timePerPickSeconds?: number;
  autoPickPolicy?: string;
  tierConfig?: ContestConfigurationTier[];
  budget?: number;
  pricingMethod?: string;
  pickCount?: number;
  isExclusive?: boolean;
  picksPerPeriod?: number;
  roundValues?: number[];
  startRound?: string;
  locksAt?: Date;
  minimumEntries?: number;
  maxEntriesPerSquad?: number;
  rosterSize?: number;
  totalPrizePoolAmount?: number;
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
