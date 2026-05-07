import type {
  AggregationDefinitionId,
  ParticipantScoringDefinitionId,
} from '@poolmaster/shared/domain';

export interface ParticipantContestScoringRule {
  id: string;
  participantScoringDefinitionId: ParticipantScoringDefinitionId;
  sortOrder: number;
  config: Record<string, unknown>;
  active: boolean;
}

export interface ContestEntryAggregationRule {
  id: string;
  aggregationDefinitionId: AggregationDefinitionId;
  config: Record<string, unknown>;
  active: boolean;
}

export interface ScoreableContestEntryPick {
  id: string;
  sportEventParticipantId: string;
}

export interface ContestParticipantSourceDataRecord {
  sportEventParticipantId: string;
  rawPayload: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
}

export interface ComputedContestEntryParticipantScoreEvent {
  pickId: string;
  participantContestScoringRuleId: string;
  points: number;
  detailsJson: Record<string, unknown>;
}

export interface ComputedContestEntryParticipantScore {
  pickId: string;
  pointsEarned: number;
}

export interface ScoreContestEntryContext {
  picks: ScoreableContestEntryPick[];
  sourceData: ContestParticipantSourceDataRecord[];
  scoringRules: ParticipantContestScoringRule[];
  aggregationRule: ContestEntryAggregationRule;
}

export interface ScoreContestEntryResult {
  totalScore: number;
  participantScores: ComputedContestEntryParticipantScore[];
  scoreEvents: ComputedContestEntryParticipantScoreEvent[];
}

export interface TeamWinEvent {
  round: number;
  seed?: number;
  opponentSeed?: number;
}

export interface GolfParticipantNormalizedData {
  scoreToPar?: number;
  madeCut?: boolean;
}

export interface TeamParticipantNormalizedData {
  wins?: number;
  losses?: number;
  seriesWins?: number;
  roundReached?: number | string;
  advanced?: boolean;
  completedWins?: TeamWinEvent[];
}

export type ScoreParticipantRuleFn = (
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
) => ComputedContestEntryParticipantScoreEvent[];

export type AggregateEntryScoreFn = (
  participantScores: ComputedContestEntryParticipantScore[],
  aggregationRule: ContestEntryAggregationRule,
) => number;

export interface ParticipantScoringDefinitionRegistryItem {
  id: ParticipantScoringDefinitionId;
  name: string;
  description: string;
  supportedContestTypes: string[];
  scoreParticipant: ScoreParticipantRuleFn;
}

export interface EntryAggregationRegistryItem {
  id: AggregationDefinitionId;
  name: string;
  description: string;
  aggregateEntry: AggregateEntryScoreFn;
}
