import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestCoreSummary,
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
        contestFormat: contest.contestFormat,
        selectionType: contest.selectionType,
        scoringEngine: contest.scoringEngine,
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
        ...(updates.contestFormat !== undefined && {
          contestFormat: updates.contestFormat,
        }),
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
        templateId: configuration.templateId,
        templateVersion: configuration.templateVersion,
        selectionType: configuration.selectionType,
        configJson: configuration.configJson as object | undefined,
        rounds: configuration.rounds,
        timePerPickSeconds: configuration.timePerPickSeconds,
        autoPickPolicy: configuration.autoPickPolicy,
        tierConfig: configuration.tierConfig as object[] | undefined,
        budget: configuration.budget,
        pickCount: configuration.pickCount,
        isExclusive: configuration.isExclusive ?? false,
        picksPerPeriod: configuration.picksPerPeriod,
        roundValues: configuration.roundValues,
        startRound: configuration.startRound,
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
        ...(updates.templateId !== undefined && {
          templateId: updates.templateId,
        }),
        ...(updates.templateVersion !== undefined && {
          templateVersion: updates.templateVersion,
        }),
        ...(updates.selectionType !== undefined && {
          selectionType: updates.selectionType,
        }),
        ...(updates.configJson !== undefined && {
          configJson: updates.configJson as object,
        }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.timePerPickSeconds !== undefined && {
          timePerPickSeconds: updates.timePerPickSeconds,
        }),
        ...(updates.autoPickPolicy !== undefined && {
          autoPickPolicy: updates.autoPickPolicy,
        }),
        ...(updates.tierConfig !== undefined && {
          tierConfig: updates.tierConfig as object[],
        }),
        ...(updates.budget !== undefined && { budget: updates.budget }),
        ...(updates.pickCount !== undefined && { pickCount: updates.pickCount }),
        ...(updates.isExclusive !== undefined && {
          isExclusive: updates.isExclusive,
        }),
        ...(updates.picksPerPeriod !== undefined && {
          picksPerPeriod: updates.picksPerPeriod,
        }),
        ...(updates.roundValues !== undefined && {
          roundValues: updates.roundValues,
        }),
        ...(updates.startRound !== undefined && {
          startRound: updates.startRound,
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

export class PrismaContestConfigTemplateRepository
  implements ContestConfigTemplateRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestConfigTemplate | null> {
    const row = await this.prisma.contestConfigTemplate.findUnique({
      where: { id },
    });
    return row ? mapContestConfigTemplate(row) : null;
  }

  async list(input: {
    sport?: ContestConfigTemplate['sport'];
    contestFormat?: ContestConfigTemplate['contestFormat'];
    eventType?: string | null;
    active?: boolean;
  } = {}): Promise<ContestConfigTemplate[]> {
    const rows = await this.prisma.contestConfigTemplate.findMany({
      where: {
        ...(input.sport !== undefined && { sport: input.sport }),
        ...(input.contestFormat !== undefined && { contestFormat: input.contestFormat }),
        // An event type narrows to that type's templates plus the ones for any event type.
        ...(input.eventType !== undefined && { OR: [{ eventType: input.eventType }, { eventType: null }] }),
        ...(input.active !== undefined && { active: input.active }),
      },
      orderBy: [
        { sport: 'asc' },
        { contestFormat: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    return rows.map(mapContestConfigTemplate);
  }

  async update(
    id: string,
    updates: Partial<ContestConfigTemplate>,
  ): Promise<ContestConfigTemplate> {
    const row = await this.prisma.contestConfigTemplate.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        ...(updates.active !== undefined && { active: updates.active }),
        ...(updates.configJson !== undefined && { configJson: updates.configJson as object }),
        ...(updates.schemaVersion !== undefined && { schemaVersion: updates.schemaVersion }),
      },
    });

    return mapContestConfigTemplate(row);
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
  contestFormat: string;
  selectionType: string;
  scoringEngine: string;
  createdAt: Date;
  updatedAt: Date;
}): ContestCoreSummary {
  return {
    id: row.id,
    leagueId: row.leagueId,
    sportEventId: row.sportEventId ?? '',
    name: row.name,
    status: row.status as ContestCoreSummary['status'],
    contestFormat: row.contestFormat as ContestCoreSummary['contestFormat'],
    selectionType: row.selectionType as ContestCoreSummary['selectionType'],
    scoringEngine: row.scoringEngine as ContestCoreSummary['scoringEngine'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContestConfiguration(row: {
  id: string;
  contestId: string;
  templateId: string | null;
  templateVersion: number | null;
  selectionType: string;
  configJson: unknown;
  rounds: number | null;
  timePerPickSeconds: number | null;
  autoPickPolicy: string | null;
  tierConfig: unknown;
  budget: number | null;
  pickCount: number | null;
  isExclusive: boolean;
  picksPerPeriod: number | null;
  roundValues: unknown;
  startRound: string | null;
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
    templateId: row.templateId ?? undefined,
    templateVersion: row.templateVersion ?? undefined,
    selectionType: row.selectionType as ContestConfiguration['selectionType'],
    configJson: row.configJson as ContestConfiguration['configJson'],
    rounds: row.rounds ?? undefined,
    timePerPickSeconds: row.timePerPickSeconds ?? undefined,
    autoPickPolicy: row.autoPickPolicy ?? undefined,
    tierConfig: (row.tierConfig as ContestConfiguration['tierConfig']) ?? undefined,
    budget: row.budget ?? undefined,
    pickCount: row.pickCount ?? undefined,
    isExclusive: row.isExclusive,
    picksPerPeriod: row.picksPerPeriod ?? undefined,
    roundValues: (row.roundValues as number[]) ?? undefined,
    startRound: row.startRound ?? undefined,
    locksAt: row.locksAt ?? undefined,
    minimumEntries: row.minimumEntries ?? undefined,
    maxEntriesPerSquad: row.maxEntriesPerSquad ?? undefined,
    rosterSize: row.rosterSize ?? undefined,
    totalPrizePoolAmount: row.totalPrizePoolAmount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContestConfigTemplate(row: {
  id: string;
  sport: string;
  eventType: string | null;
  contestFormat: string;
  selectionType: string;
  templateKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  configJson: unknown;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): ContestConfigTemplate {
  return {
    id: row.id,
    sport: row.sport as ContestConfigTemplate['sport'],
    eventType: row.eventType ?? undefined,
    contestFormat: row.contestFormat as ContestConfigTemplate['contestFormat'],
    selectionType: row.selectionType as ContestConfigTemplate['selectionType'],
    templateKey: row.templateKey,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    active: row.active,
    configJson: row.configJson as ContestConfigTemplate['configJson'],
    schemaVersion: row.schemaVersion,
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
