import type {
  ContestConfigTemplate,
  ContestCoreSummary,
  ContestConfiguration,
  ContestPrizeDefinition,
  ParticipantContestScoringRule,
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

export interface ContestConfigTemplateRepository {
  findById(id: string): Promise<ContestConfigTemplate | null>;
  /**
   * Ordered by sport, format, sort order, name. `eventType` narrows to that type's templates
   * plus the ones for any event type; every filter is optional.
   */
  list(input?: {
    sport?: ContestConfigTemplate['sport'];
    contestFormat?: ContestConfigTemplate['contestFormat'];
    eventType?: string | null;
    active?: boolean;
  }): Promise<ContestConfigTemplate[]>;
  update(
    id: string,
    updates: Partial<ContestConfigTemplate>,
  ): Promise<ContestConfigTemplate>;
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
