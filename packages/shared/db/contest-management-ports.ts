import type {
  ContestCoreSummary,
  ContestConfiguration,
  ContestEntryAggregationRule,
  ContestEntryParticipantScore,
  ContestEntryParticipantScoreEvent,
  ContestEntryPrizeAward,
  ContestPrizeDefinition,
  ParticipantContestScoringRule,
  SportEventParticipant,
  SportEventParticipantSourceData,
  SportEventParticipantValuation,
} from '../domain';

export interface ContestCoreRepository {
  findById(id: string): Promise<ContestCoreSummary | null>;
  findByLeague(leagueId: string): Promise<ContestCoreSummary[]>;
  create(
    contest: Omit<ContestCoreSummary, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestCoreSummary>;
  update(
    id: string,
    updates: Partial<ContestCoreSummary>,
  ): Promise<ContestCoreSummary>;
  delete(id: string): Promise<void>;
}

export interface SportEventParticipantRepository {
  findById(id: string): Promise<SportEventParticipant | null>;
  findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]>;
  create(
    participant: Omit<SportEventParticipant, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SportEventParticipant>;
  update(
    id: string,
    updates: Partial<SportEventParticipant>,
  ): Promise<SportEventParticipant>;
}

export interface SportEventParticipantSourceDataRepository {
  findById(id: string): Promise<SportEventParticipantSourceData | null>;
  findBySportEventParticipant(
    sportEventParticipantId: string,
  ): Promise<SportEventParticipantSourceData[]>;
  create(
    sourceData: Omit<
      SportEventParticipantSourceData,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SportEventParticipantSourceData>;
  update(
    id: string,
    updates: Partial<SportEventParticipantSourceData>,
  ): Promise<SportEventParticipantSourceData>;
}

export interface SportEventParticipantValuationRepository {
  findById(id: string): Promise<SportEventParticipantValuation | null>;
  findBySportEventParticipant(
    sportEventParticipantId: string,
  ): Promise<SportEventParticipantValuation[]>;
  create(
    valuation: Omit<
      SportEventParticipantValuation,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SportEventParticipantValuation>;
  update(
    id: string,
    updates: Partial<SportEventParticipantValuation>,
  ): Promise<SportEventParticipantValuation>;
}

export interface ContestConfigurationRepository {
  findById(id: string): Promise<ContestConfiguration | null>;
  findByContest(contestId: string): Promise<ContestConfiguration | null>;
  create(
    configuration: Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestConfiguration>;
  update(
    id: string,
    updates: Partial<ContestConfiguration>,
  ): Promise<ContestConfiguration>;
}

export interface ParticipantContestScoringRuleRepository {
  findById(id: string): Promise<ParticipantContestScoringRule | null>;
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]>;
  create(
    rule: Omit<ParticipantContestScoringRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantContestScoringRule>;
  update(
    id: string,
    updates: Partial<ParticipantContestScoringRule>,
  ): Promise<ParticipantContestScoringRule>;
  delete(id: string): Promise<void>;
}

export interface ContestEntryAggregationRuleRepository {
  findById(id: string): Promise<ContestEntryAggregationRule | null>;
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ContestEntryAggregationRule | null>;
  create(
    rule: Omit<ContestEntryAggregationRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryAggregationRule>;
  update(
    id: string,
    updates: Partial<ContestEntryAggregationRule>,
  ): Promise<ContestEntryAggregationRule>;
}

export interface ContestPrizeDefinitionRepository {
  findById(id: string): Promise<ContestPrizeDefinition | null>;
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ContestPrizeDefinition[]>;
  create(
    definition: Omit<ContestPrizeDefinition, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestPrizeDefinition>;
  update(
    id: string,
    updates: Partial<ContestPrizeDefinition>,
  ): Promise<ContestPrizeDefinition>;
  delete(id: string): Promise<void>;
}

export interface ContestEntryParticipantScoreRepository {
  findById(id: string): Promise<ContestEntryParticipantScore | null>;
  findByEntry(entryId: string): Promise<ContestEntryParticipantScore[]>;
  create(
    score: Omit<ContestEntryParticipantScore, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryParticipantScore>;
  update(
    id: string,
    updates: Partial<ContestEntryParticipantScore>,
  ): Promise<ContestEntryParticipantScore>;
}

export interface ContestEntryParticipantScoreEventRepository {
  findById(id: string): Promise<ContestEntryParticipantScoreEvent | null>;
  findByParticipantScore(
    contestEntryParticipantScoreId: string,
  ): Promise<ContestEntryParticipantScoreEvent[]>;
  create(
    event: Omit<
      ContestEntryParticipantScoreEvent,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<ContestEntryParticipantScoreEvent>;
  createMany(
    events: Omit<
      ContestEntryParticipantScoreEvent,
      'id' | 'createdAt' | 'updatedAt'
    >[],
  ): Promise<number>;
  deleteByParticipantScore(contestEntryParticipantScoreId: string): Promise<number>;
}

export interface ContestEntryPrizeAwardRepository {
  findById(id: string): Promise<ContestEntryPrizeAward | null>;
  findByEntry(entryId: string): Promise<ContestEntryPrizeAward[]>;
  create(
    award: Omit<ContestEntryPrizeAward, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryPrizeAward>;
  deleteByEntry(entryId: string): Promise<number>;
}
