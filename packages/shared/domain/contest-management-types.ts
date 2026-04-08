import type { ContestStatus, SelectionType } from './enums';
import type { AggregationDefinitionId, ParticipantScoringDefinitionId } from './contest-scoring';
import type { DomainEntity } from './types';

export interface ContestConfigurationTier {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

export interface SportEventParticipant extends DomainEntity {
  sportEventId: string;
  participantId: string;
  status?: string;
  metadata: Record<string, unknown>;
}

export interface SportEventParticipantSourceData extends DomainEntity {
  sportEventParticipantId: string;
  providerId: string;
  externalId: string;
  rawPayload: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  receivedAt: Date;
}

export interface SportEventParticipantValuation extends DomainEntity {
  sportEventParticipantId: string;
  price?: number;
  tier?: string;
  orderIndex?: number;
  valuationSource: string;
}

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

export interface ParticipantContestScoringRule extends DomainEntity {
  contestConfigurationId: string;
  participantScoringDefinitionId: ParticipantScoringDefinitionId;
  sortOrder: number;
  config: Record<string, unknown>;
  active: boolean;
}

export interface ContestEntryAggregationRule extends DomainEntity {
  contestConfigurationId: string;
  aggregationDefinitionId: AggregationDefinitionId;
  config: Record<string, unknown>;
  active: boolean;
}

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

export interface ContestEntryParticipantScore extends DomainEntity {
  entryId: string;
  rosterPickId: string;
  pointsEarned: number;
}

export interface ContestEntryParticipantScoreEvent extends DomainEntity {
  contestEntryParticipantScoreId: string;
  participantContestScoringRuleId: string;
  points: number;
  detailsJson: Record<string, unknown>;
}

export interface ContestEntryPrizeAward extends DomainEntity {
  entryId: string;
  contestPrizeDefinitionId: string;
  prizeDefinitionId?: string;
  displayName: string;
  amount?: number;
  percentage?: number;
  awardedAt: Date;
}

export interface ContestCoreSummary extends DomainEntity {
  leagueId: string;
  sportEventId: string;
  name: string;
  status: ContestStatus;
}
