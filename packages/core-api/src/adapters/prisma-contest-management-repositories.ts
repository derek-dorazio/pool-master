import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfiguration,
  ContestCoreSummary,
  ContestEntryAggregationRule,
  ContestPrizeDefinition,
  ParticipantContestScoringRule,
} from '@poolmaster/shared/domain';

export class PrismaContestCoreRepository implements ContestCoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestCoreSummary | null> {
    const row = await this.prisma.contest.findUnique({ where: { id } });
    return row ? mapContest(row) : null;
  }

  async findByLeague(leagueId: string): Promise<ContestCoreSummary[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapContest);
  }

  async create(
    contest: Omit<ContestCoreSummary, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestCoreSummary> {
    const row = await this.prisma.contest.create({
      data: {
        leagueId: contest.leagueId,
        sportEventId: contest.sportEventId,
        name: contest.name,
        status: contest.status,
        contestType: 'SINGLE_EVENT',
        selectionType: 'OPEN_SELECTION',
        scoringEngine: 'MANUAL',
      },
    });
    return mapContest(row);
  }

  async update(
    id: string,
    updates: Partial<ContestCoreSummary>,
  ): Promise<ContestCoreSummary> {
    const row = await this.prisma.contest.update({
      where: { id },
      data: {
        ...(updates.leagueId !== undefined && { leagueId: updates.leagueId }),
        ...(updates.sportEventId !== undefined && {
          sportEventId: updates.sportEventId,
        }),
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
      },
    });
    return mapContest(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contest.delete({ where: { id } });
  }
}

export class PrismaContestConfigurationRepository
  implements ContestConfigurationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestConfiguration | null> {
    const row = await this.prisma.contestConfiguration.findUnique({
      where: { id },
    });
    return row ? mapContestConfiguration(row) : null;
  }

  async findByContest(contestId: string): Promise<ContestConfiguration | null> {
    const row = await this.prisma.contestConfiguration.findUnique({
      where: { contestId },
    });
    return row ? mapContestConfiguration(row) : null;
  }

  async create(
    configuration: Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestConfiguration> {
    const row = await this.prisma.contestConfiguration.create({
      data: {
        contestId: configuration.contestId,
        selectionType: configuration.selectionType,
        locksAt: configuration.locksAt,
        minimumEntries: configuration.minimumEntries,
        maxEntriesPerSquad: configuration.maxEntriesPerSquad,
        rosterSize: configuration.rosterSize,
        totalPrizePoolAmount: configuration.totalPrizePoolAmount,
      },
    });
    return mapContestConfiguration(row);
  }

  async update(
    id: string,
    updates: Partial<ContestConfiguration>,
  ): Promise<ContestConfiguration> {
    const row = await this.prisma.contestConfiguration.update({
      where: { id },
      data: {
        ...(updates.selectionType !== undefined && {
          selectionType: updates.selectionType,
        }),
        ...(updates.locksAt !== undefined && { locksAt: updates.locksAt }),
        ...(updates.minimumEntries !== undefined && {
          minimumEntries: updates.minimumEntries,
        }),
        ...(updates.maxEntriesPerSquad !== undefined && {
          maxEntriesPerSquad: updates.maxEntriesPerSquad,
        }),
        ...(updates.rosterSize !== undefined && { rosterSize: updates.rosterSize }),
        ...(updates.totalPrizePoolAmount !== undefined && {
          totalPrizePoolAmount: updates.totalPrizePoolAmount,
        }),
      },
    });
    return mapContestConfiguration(row);
  }
}

export class PrismaParticipantContestScoringRuleRepository
  implements ParticipantContestScoringRuleRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ParticipantContestScoringRule | null> {
    const row = await this.prisma.participantContestScoringRule.findUnique({
      where: { id },
    });
    return row ? mapParticipantScoringRule(row) : null;
  }

  async findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]> {
    const rows = await this.prisma.participantContestScoringRule.findMany({
      where: { contestConfigurationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(mapParticipantScoringRule);
  }

  async create(
    rule: Omit<ParticipantContestScoringRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantContestScoringRule> {
    const row = await this.prisma.participantContestScoringRule.create({
      data: {
        contestConfigurationId: rule.contestConfigurationId,
        participantScoringDefinitionId: rule.participantScoringDefinitionId,
        sortOrder: rule.sortOrder,
        config: rule.config as object,
        active: rule.active,
      },
    });
    return mapParticipantScoringRule(row);
  }

  async update(
    id: string,
    updates: Partial<ParticipantContestScoringRule>,
  ): Promise<ParticipantContestScoringRule> {
    const row = await this.prisma.participantContestScoringRule.update({
      where: { id },
      data: {
        ...(updates.participantScoringDefinitionId !== undefined && {
          participantScoringDefinitionId: updates.participantScoringDefinitionId,
        }),
        ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
        ...(updates.config !== undefined && { config: updates.config as object }),
        ...(updates.active !== undefined && { active: updates.active }),
      },
    });
    return mapParticipantScoringRule(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.participantContestScoringRule.delete({ where: { id } });
  }
}

export class PrismaContestEntryAggregationRuleRepository
  implements ContestEntryAggregationRuleRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestEntryAggregationRule | null> {
    const row = await this.prisma.contestEntryAggregationRule.findUnique({
      where: { id },
    });
    return row ? mapAggregationRule(row) : null;
  }

  async findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ContestEntryAggregationRule | null> {
    const row = await this.prisma.contestEntryAggregationRule.findUnique({
      where: { contestConfigurationId },
    });
    return row ? mapAggregationRule(row) : null;
  }

  async create(
    rule: Omit<ContestEntryAggregationRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryAggregationRule> {
    const row = await this.prisma.contestEntryAggregationRule.create({
      data: {
        contestConfigurationId: rule.contestConfigurationId,
        aggregationDefinitionId: rule.aggregationDefinitionId,
        config: rule.config as object,
        active: rule.active,
      },
    });
    return mapAggregationRule(row);
  }

  async update(
    id: string,
    updates: Partial<ContestEntryAggregationRule>,
  ): Promise<ContestEntryAggregationRule> {
    const row = await this.prisma.contestEntryAggregationRule.update({
      where: { id },
      data: {
        ...(updates.aggregationDefinitionId !== undefined && {
          aggregationDefinitionId: updates.aggregationDefinitionId,
        }),
        ...(updates.config !== undefined && { config: updates.config as object }),
        ...(updates.active !== undefined && { active: updates.active }),
      },
    });
    return mapAggregationRule(row);
  }
}

export class PrismaContestPrizeDefinitionRepository
  implements ContestPrizeDefinitionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestPrizeDefinition | null> {
    const row = await this.prisma.contestPrizeDefinition.findUnique({
      where: { id },
    });
    return row ? mapPrizeDefinition(row) : null;
  }

  async findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ContestPrizeDefinition[]> {
    const rows = await this.prisma.contestPrizeDefinition.findMany({
      where: { contestConfigurationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(mapPrizeDefinition);
  }

  async create(
    definition: Omit<ContestPrizeDefinition, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestPrizeDefinition> {
    const row = await this.prisma.contestPrizeDefinition.create({
      data: {
        contestConfigurationId: definition.contestConfigurationId,
        prizeDefinitionId: definition.prizeDefinitionId,
        displayName: definition.displayName,
        sortOrder: definition.sortOrder,
        ruleConfig: definition.ruleConfig as object,
        payoutType: definition.payoutType,
        amount: definition.amount,
        percentage: definition.percentage,
        active: definition.active,
      },
    });
    return mapPrizeDefinition(row);
  }

  async update(
    id: string,
    updates: Partial<ContestPrizeDefinition>,
  ): Promise<ContestPrizeDefinition> {
    const row = await this.prisma.contestPrizeDefinition.update({
      where: { id },
      data: {
        ...(updates.prizeDefinitionId !== undefined && {
          prizeDefinitionId: updates.prizeDefinitionId,
        }),
        ...(updates.displayName !== undefined && { displayName: updates.displayName }),
        ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
        ...(updates.ruleConfig !== undefined && {
          ruleConfig: updates.ruleConfig as object,
        }),
        ...(updates.payoutType !== undefined && { payoutType: updates.payoutType }),
        ...(updates.amount !== undefined && { amount: updates.amount }),
        ...(updates.percentage !== undefined && { percentage: updates.percentage }),
        ...(updates.active !== undefined && { active: updates.active }),
      },
    });
    return mapPrizeDefinition(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contestPrizeDefinition.delete({ where: { id } });
  }
}

function mapContest(row: {
  id: string;
  leagueId: string;
  sportEventId: string | null;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ContestCoreSummary {
  return {
    id: row.id,
    leagueId: row.leagueId,
    sportEventId: row.sportEventId ?? '',
    name: row.name,
    status: row.status as ContestCoreSummary['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContestConfiguration(row: {
  id: string;
  contestId: string;
  selectionType: string;
  locksAt: Date | null;
  minimumEntries: number | null;
  maxEntriesPerSquad: number | null;
  rosterSize: number | null;
  totalPrizePoolAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestConfiguration {
  return {
    id: row.id,
    contestId: row.contestId,
    selectionType: row.selectionType as ContestConfiguration['selectionType'],
    locksAt: row.locksAt ?? undefined,
    minimumEntries: row.minimumEntries ?? undefined,
    maxEntriesPerSquad: row.maxEntriesPerSquad ?? undefined,
    rosterSize: row.rosterSize ?? undefined,
    totalPrizePoolAmount: row.totalPrizePoolAmount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapParticipantScoringRule(row: {
  id: string;
  contestConfigurationId: string;
  participantScoringDefinitionId: string;
  sortOrder: number;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantContestScoringRule {
  return {
    id: row.id,
    contestConfigurationId: row.contestConfigurationId,
    participantScoringDefinitionId:
      row.participantScoringDefinitionId as ParticipantContestScoringRule['participantScoringDefinitionId'],
    sortOrder: row.sortOrder,
    config: (row.config ?? {}) as Record<string, unknown>,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAggregationRule(row: {
  id: string;
  contestConfigurationId: string;
  aggregationDefinitionId: string;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntryAggregationRule {
  return {
    id: row.id,
    contestConfigurationId: row.contestConfigurationId,
    aggregationDefinitionId:
      row.aggregationDefinitionId as ContestEntryAggregationRule['aggregationDefinitionId'],
    config: (row.config ?? {}) as Record<string, unknown>,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPrizeDefinition(row: {
  id: string;
  contestConfigurationId: string;
  prizeDefinitionId: string;
  displayName: string;
  sortOrder: number;
  ruleConfig: unknown;
  payoutType: string | null;
  amount: number | null;
  percentage: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ContestPrizeDefinition {
  return {
    id: row.id,
    contestConfigurationId: row.contestConfigurationId,
    prizeDefinitionId: row.prizeDefinitionId,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
    ruleConfig: (row.ruleConfig ?? {}) as Record<string, unknown>,
    payoutType: row.payoutType as ContestPrizeDefinition['payoutType'],
    amount: row.amount ?? undefined,
    percentage: row.percentage ?? undefined,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
