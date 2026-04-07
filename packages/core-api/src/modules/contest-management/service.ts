import type {
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestManagementDetailDto,
  ContestPrizeDefinitionRequest,
  CreateContestManagementRequest,
  ParticipantContestScoringRuleRequest,
  UpdateContestConfigurationRequest,
} from '@poolmaster/shared/dto';
import { ContestStatus } from '@poolmaster/shared/domain';

interface CreateContestManagementContext {
  leagueId: string;
}

export class ContestManagementService {
  constructor(
    private readonly contestCoreRepo: ContestCoreRepository,
    private readonly contestConfigurationRepo: ContestConfigurationRepository,
    private readonly participantContestScoringRuleRepo: ParticipantContestScoringRuleRepository,
    private readonly contestEntryAggregationRuleRepo: ContestEntryAggregationRuleRepository,
    private readonly contestPrizeDefinitionRepo: ContestPrizeDefinitionRepository,
  ) {}

  async createContest(
    context: CreateContestManagementContext,
    input: CreateContestManagementRequest,
  ): Promise<ContestManagementDetailDto> {
    validateParticipantScoringRules(input.configuration.participantScoringRules);
    validatePrizeDefinitions(input.configuration.prizeDefinitions);

    const contest = await this.contestCoreRepo.create({
      leagueId: context.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      status: ContestStatus.DRAFT,
    });

    const configuration = await this.contestConfigurationRepo.create({
      contestId: contest.id,
      selectionType: input.configuration.selectionType,
      locksAt: input.configuration.locksAt
        ? new Date(input.configuration.locksAt)
        : undefined,
      minimumEntries: input.configuration.minimumEntries,
      maxEntriesPerSquad: input.configuration.maxEntriesPerSquad,
      rosterSize: input.configuration.rosterSize,
      totalPrizePoolAmount: input.configuration.totalPrizePoolAmount ?? undefined,
    });

    const participantScoringRules = await createParticipantScoringRules(
      configuration.id,
      input.configuration.participantScoringRules,
      this.participantContestScoringRuleRepo,
    );

    const entryAggregationRule = await this.contestEntryAggregationRuleRepo.create({
      contestConfigurationId: configuration.id,
      aggregationDefinitionId:
        input.configuration.entryAggregationRule.aggregationDefinitionId,
      config: input.configuration.entryAggregationRule.config,
      active: input.configuration.entryAggregationRule.active,
    });

    const prizeDefinitions = await createPrizeDefinitions(
      configuration.id,
      input.configuration.prizeDefinitions,
      this.contestPrizeDefinitionRepo,
    );

    return buildContestManagementDetail(
      contest,
      configuration,
      participantScoringRules,
      entryAggregationRule,
      prizeDefinitions,
    );
  }

  async getContest(contestId: string): Promise<ContestManagementDetailDto> {
    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      throw new ContestManagementError('Contest not found');
    }

    const configuration = await this.contestConfigurationRepo.findByContest(contestId);
    if (!configuration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    const participantScoringRules =
      await this.participantContestScoringRuleRepo.findByContestConfiguration(
        configuration.id,
      );
    const entryAggregationRule =
      await this.contestEntryAggregationRuleRepo.findByContestConfiguration(
        configuration.id,
      );
    if (!entryAggregationRule) {
      throw new ContestManagementError('Contest entry aggregation rule not found');
    }
    const prizeDefinitions =
      await this.contestPrizeDefinitionRepo.findByContestConfiguration(
        configuration.id,
      );

    return buildContestManagementDetail(
      contest,
      configuration,
      participantScoringRules,
      entryAggregationRule,
      prizeDefinitions,
    );
  }

  async updateContestConfiguration(
    contestId: string,
    input: UpdateContestConfigurationRequest,
  ): Promise<ContestManagementDetailDto> {
    const configuration = await this.contestConfigurationRepo.findByContest(contestId);
    if (!configuration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    validateParticipantScoringRules(input.participantScoringRules);
    validatePrizeDefinitions(input.prizeDefinitions);

    await this.contestConfigurationRepo.update(configuration.id, {
      selectionType: input.selectionType,
      locksAt: input.locksAt ? new Date(input.locksAt) : undefined,
      minimumEntries: input.minimumEntries,
      maxEntriesPerSquad: input.maxEntriesPerSquad,
      rosterSize: input.rosterSize,
      totalPrizePoolAmount: input.totalPrizePoolAmount ?? undefined,
    });

    const existingParticipantRules =
      await this.participantContestScoringRuleRepo.findByContestConfiguration(
        configuration.id,
      );
    await Promise.all(
      existingParticipantRules.map((rule) =>
        this.participantContestScoringRuleRepo.delete(rule.id),
      ),
    );
    const participantScoringRules = await createParticipantScoringRules(
      configuration.id,
      input.participantScoringRules,
      this.participantContestScoringRuleRepo,
    );

    const existingAggregationRule =
      await this.contestEntryAggregationRuleRepo.findByContestConfiguration(
        configuration.id,
      );
    const entryAggregationRule = existingAggregationRule
      ? await this.contestEntryAggregationRuleRepo.update(existingAggregationRule.id, {
          aggregationDefinitionId:
            input.entryAggregationRule.aggregationDefinitionId,
          config: input.entryAggregationRule.config,
          active: input.entryAggregationRule.active,
        })
      : await this.contestEntryAggregationRuleRepo.create({
          contestConfigurationId: configuration.id,
          aggregationDefinitionId:
            input.entryAggregationRule.aggregationDefinitionId,
          config: input.entryAggregationRule.config,
          active: input.entryAggregationRule.active,
        });

    const existingPrizeDefinitions =
      await this.contestPrizeDefinitionRepo.findByContestConfiguration(
        configuration.id,
      );
    await Promise.all(
      existingPrizeDefinitions.map((definition) =>
        this.contestPrizeDefinitionRepo.delete(definition.id),
      ),
    );
    const prizeDefinitions = await createPrizeDefinitions(
      configuration.id,
      input.prizeDefinitions,
      this.contestPrizeDefinitionRepo,
    );

    const contest = await this.contestCoreRepo.findById(contestId);
    if (!contest) {
      throw new ContestManagementError('Contest not found');
    }
    const updatedConfiguration =
      await this.contestConfigurationRepo.findByContest(contestId);
    if (!updatedConfiguration) {
      throw new ContestManagementError('Contest configuration not found');
    }

    return buildContestManagementDetail(
      contest,
      updatedConfiguration,
      participantScoringRules,
      entryAggregationRule,
      prizeDefinitions,
    );
  }
}

export class ContestManagementError extends Error {}

function validateParticipantScoringRules(
  rules: ParticipantContestScoringRuleRequest[],
): void {
  if (rules.length === 0) {
    throw new ContestManagementError(
      'At least one participant scoring rule is required',
    );
  }

  const sortOrders = new Set<number>();
  for (const rule of rules) {
    if (sortOrders.has(rule.sortOrder)) {
      throw new ContestManagementError(
        'Participant scoring rules must have unique sortOrder values',
      );
    }
    sortOrders.add(rule.sortOrder);
  }
}

function validatePrizeDefinitions(
  prizeDefinitions: ContestPrizeDefinitionRequest[],
): void {
  for (const definition of prizeDefinitions) {
    if (definition.payoutType === 'FIXED_AMOUNT' && definition.amount == null) {
      throw new ContestManagementError(
        `Prize definition ${definition.displayName} requires amount for FIXED_AMOUNT payouts`,
      );
    }

    if (
      definition.payoutType === 'PERCENTAGE' &&
      definition.percentage == null
    ) {
      throw new ContestManagementError(
        `Prize definition ${definition.displayName} requires percentage for PERCENTAGE payouts`,
      );
    }
  }
}

async function createParticipantScoringRules(
  contestConfigurationId: string,
  rules: ParticipantContestScoringRuleRequest[],
  repository: ParticipantContestScoringRuleRepository,
) {
  return Promise.all(
    rules.map((rule) =>
      repository.create({
        contestConfigurationId,
        participantScoringDefinitionId: rule.participantScoringDefinitionId,
        sortOrder: rule.sortOrder,
        config: rule.config,
        active: rule.active,
      }),
    ),
  );
}

async function createPrizeDefinitions(
  contestConfigurationId: string,
  prizeDefinitions: ContestPrizeDefinitionRequest[],
  repository: ContestPrizeDefinitionRepository,
) {
  return Promise.all(
    prizeDefinitions.map((definition) =>
      repository.create({
        contestConfigurationId,
        prizeDefinitionId: definition.prizeDefinitionId,
        displayName: definition.displayName,
        sortOrder: definition.sortOrder,
        ruleConfig: definition.ruleConfig,
        payoutType: definition.payoutType,
        amount: definition.amount,
        percentage: definition.percentage,
        active: definition.active,
      }),
    ),
  );
}

function buildContestManagementDetail(
  contest: {
    id: string;
    leagueId: string;
    sportEventId: string;
    name: string;
    status: ContestManagementDetailDto['status'];
    createdAt: Date;
    updatedAt: Date;
  },
  configuration: {
    id: string;
    contestId: string;
    selectionType: string;
    locksAt?: Date;
    minimumEntries?: number;
    maxEntriesPerSquad?: number;
    rosterSize?: number;
    totalPrizePoolAmount?: number;
  },
  participantScoringRules: Array<{
    id: string;
    participantScoringDefinitionId: string;
    sortOrder: number;
    config: Record<string, unknown>;
    active: boolean;
  }>,
  entryAggregationRule: {
    id: string;
    aggregationDefinitionId: string;
    config: Record<string, unknown>;
    active: boolean;
  },
  prizeDefinitions: Array<{
    id: string;
    prizeDefinitionId: string;
    displayName: string;
    sortOrder: number;
    ruleConfig: Record<string, unknown>;
    payoutType?: string;
    amount?: number;
    percentage?: number;
    active: boolean;
  }>,
): ContestManagementDetailDto {
  return {
    id: contest.id,
    leagueId: contest.leagueId,
    sportEventId: contest.sportEventId,
    name: contest.name,
    status: contest.status,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
    configuration: {
      id: configuration.id,
      contestId: configuration.contestId,
      selectionType:
        configuration.selectionType as ContestManagementDetailDto['configuration']['selectionType'],
      locksAt: configuration.locksAt?.toISOString(),
      minimumEntries: configuration.minimumEntries,
      maxEntriesPerSquad: configuration.maxEntriesPerSquad,
      rosterSize: configuration.rosterSize,
      totalPrizePoolAmount: configuration.totalPrizePoolAmount,
      participantScoringRules: participantScoringRules.map((rule) => ({
        id: rule.id,
        participantScoringDefinitionId:
          rule.participantScoringDefinitionId as ContestManagementDetailDto['configuration']['participantScoringRules'][number]['participantScoringDefinitionId'],
        sortOrder: rule.sortOrder,
        config: rule.config,
        active: rule.active,
      })),
      entryAggregationRule: {
        id: entryAggregationRule.id,
        aggregationDefinitionId:
          entryAggregationRule.aggregationDefinitionId as ContestManagementDetailDto['configuration']['entryAggregationRule']['aggregationDefinitionId'],
        config: entryAggregationRule.config,
        active: entryAggregationRule.active,
      },
      prizeDefinitions: prizeDefinitions.map((definition) => ({
        id: definition.id,
        prizeDefinitionId: definition.prizeDefinitionId,
        displayName: definition.displayName,
        sortOrder: definition.sortOrder,
        ruleConfig: definition.ruleConfig,
        payoutType:
          definition.payoutType as ContestManagementDetailDto['configuration']['prizeDefinitions'][number]['payoutType'],
        amount: definition.amount,
        percentage: definition.percentage,
        active: definition.active,
      })),
    },
  };
}
