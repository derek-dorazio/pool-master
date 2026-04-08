import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
  SportEventParticipantSourceDataRepository,
  SportEventParticipantValuationRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfiguration,
  ContestCoreSummary,
  ContestEntryAggregationRule,
  ContestPrizeDefinition,
  ParticipantContestScoringRule,
  SportEventParticipant,
  SportEventParticipantSourceData,
  SportEventParticipantValuation,
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

export class PrismaSportEventParticipantRepository
  implements SportEventParticipantRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportEventParticipant | null> {
    const row = await this.prisma.sportEventParticipant.findUnique({
      where: { id },
    });
    return row ? mapSportEventParticipant(row) : null;
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapSportEventParticipant);
  }

  async create(
    participant: Omit<SportEventParticipant, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SportEventParticipant> {
    const row = await this.prisma.sportEventParticipant.create({
      data: {
        sportEventId: participant.sportEventId,
        participantId: participant.participantId,
        status: participant.status,
        metadata: participant.metadata as object,
      },
    });
    return mapSportEventParticipant(row);
  }

  async update(
    id: string,
    updates: Partial<SportEventParticipant>,
  ): Promise<SportEventParticipant> {
    const row = await this.prisma.sportEventParticipant.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.metadata !== undefined && { metadata: updates.metadata as object }),
      },
    });
    return mapSportEventParticipant(row);
  }
}

export class PrismaSportEventParticipantSourceDataRepository
  implements SportEventParticipantSourceDataRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportEventParticipantSourceData | null> {
    const row = await this.prisma.sportEventParticipantSourceData.findUnique({
      where: { id },
    });
    return row ? mapSportEventParticipantSourceData(row) : null;
  }

  async findBySportEventParticipant(
    sportEventParticipantId: string,
  ): Promise<SportEventParticipantSourceData[]> {
    const rows = await this.prisma.sportEventParticipantSourceData.findMany({
      where: { sportEventParticipantId },
      orderBy: { receivedAt: 'desc' },
    });
    return rows.map(mapSportEventParticipantSourceData);
  }

  async create(
    sourceData: Omit<
      SportEventParticipantSourceData,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SportEventParticipantSourceData> {
    const row = await this.prisma.sportEventParticipantSourceData.create({
      data: {
        sportEventParticipantId: sourceData.sportEventParticipantId,
        providerId: sourceData.providerId,
        externalId: sourceData.externalId,
        rawPayload: sourceData.rawPayload as object,
        normalizedData: sourceData.normalizedData as object,
        receivedAt: sourceData.receivedAt,
      },
    });
    return mapSportEventParticipantSourceData(row);
  }

  async update(
    id: string,
    updates: Partial<SportEventParticipantSourceData>,
  ): Promise<SportEventParticipantSourceData> {
    const row = await this.prisma.sportEventParticipantSourceData.update({
      where: { id },
      data: {
        ...(updates.providerId !== undefined && { providerId: updates.providerId }),
        ...(updates.externalId !== undefined && { externalId: updates.externalId }),
        ...(updates.rawPayload !== undefined && {
          rawPayload: updates.rawPayload as object,
        }),
        ...(updates.normalizedData !== undefined && {
          normalizedData: updates.normalizedData as object,
        }),
        ...(updates.receivedAt !== undefined && { receivedAt: updates.receivedAt }),
      },
    });
    return mapSportEventParticipantSourceData(row);
  }
}

export class PrismaSportEventParticipantValuationRepository
  implements SportEventParticipantValuationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportEventParticipantValuation | null> {
    const row = await this.prisma.sportEventParticipantValuation.findUnique({
      where: { id },
    });
    return row ? mapSportEventParticipantValuation(row) : null;
  }

  async findBySportEventParticipant(
    sportEventParticipantId: string,
  ): Promise<SportEventParticipantValuation[]> {
    const rows = await this.prisma.sportEventParticipantValuation.findMany({
      where: { sportEventParticipantId },
      orderBy: { valuationSource: 'asc' },
    });
    return rows.map(mapSportEventParticipantValuation);
  }

  async create(
    valuation: Omit<
      SportEventParticipantValuation,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SportEventParticipantValuation> {
    const row = await this.prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: valuation.sportEventParticipantId,
        price: valuation.price,
        tier: valuation.tier,
        orderIndex: valuation.orderIndex,
        valuationSource: valuation.valuationSource,
      },
    });
    return mapSportEventParticipantValuation(row);
  }

  async update(
    id: string,
    updates: Partial<SportEventParticipantValuation>,
  ): Promise<SportEventParticipantValuation> {
    const row = await this.prisma.sportEventParticipantValuation.update({
      where: { id },
      data: {
        ...(updates.price !== undefined && { price: updates.price }),
        ...(updates.tier !== undefined && { tier: updates.tier }),
        ...(updates.orderIndex !== undefined && { orderIndex: updates.orderIndex }),
        ...(updates.valuationSource !== undefined && {
          valuationSource: updates.valuationSource,
        }),
      },
    });
    return mapSportEventParticipantValuation(row);
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

function mapSportEventParticipant(row: {
  id: string;
  sportEventId: string;
  participantId: string;
  status: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SportEventParticipant {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    status: row.status ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSportEventParticipantSourceData(row: {
  id: string;
  sportEventParticipantId: string;
  providerId: string;
  externalId: string;
  rawPayload: unknown;
  normalizedData: unknown;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): SportEventParticipantSourceData {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    providerId: row.providerId,
    externalId: row.externalId,
    rawPayload: (row.rawPayload ?? {}) as Record<string, unknown>,
    normalizedData: (row.normalizedData ?? {}) as Record<string, unknown>,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSportEventParticipantValuation(row: {
  id: string;
  sportEventParticipantId: string;
  price: number | null;
  tier: string | null;
  orderIndex: number | null;
  valuationSource: string;
  createdAt: Date;
  updatedAt: Date;
}): SportEventParticipantValuation {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    price: row.price ?? undefined,
    tier: row.tier ?? undefined,
    orderIndex: row.orderIndex ?? undefined,
    valuationSource: row.valuationSource,
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
