import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
} from '@poolmaster/shared/db';
import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestCoreSummary,
  ContestEntryAggregationRule,
  ContestPrizeDefinition,
  GolfParticipantInactiveReason,
  ParticipantContestScoringRule,
  SportEventParticipant,
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
        isActive: participant.isActive,
        inactiveReason: participant.inactiveReason,
        worldRanking: participant.worldRanking,
        oddsToWin: participant.oddsToWin,
        seedNumber: participant.seedNumber,
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
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.inactiveReason !== undefined && { inactiveReason: updates.inactiveReason }),
        ...(updates.worldRanking !== undefined && { worldRanking: updates.worldRanking }),
        ...(updates.oddsToWin !== undefined && { oddsToWin: updates.oddsToWin }),
        ...(updates.seedNumber !== undefined && { seedNumber: updates.seedNumber }),
        ...(updates.metadata !== undefined && { metadata: updates.metadata as object }),
      },
    });
    return mapSportEventParticipant(row);
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
        templateId: configuration.templateId,
        templateVersion: configuration.templateVersion,
        selectionType: configuration.selectionType,
        configMode: configuration.configMode,
        configJson: configuration.configJson as object | undefined,
        rounds: configuration.rounds,
        timePerPickSeconds: configuration.timePerPickSeconds,
        autoPickPolicy: configuration.autoPickPolicy,
        tierConfig: configuration.tierConfig as object[] | undefined,
        budget: configuration.budget,
        pricingMethod: configuration.pricingMethod,
        pickCount: configuration.pickCount,
        isExclusive: configuration.isExclusive ?? false,
        picksPerPeriod: configuration.picksPerPeriod,
        roundValues: configuration.roundValues as number[] | undefined,
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
        ...(updates.configMode !== undefined && {
          configMode: updates.configMode,
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
        ...(updates.pricingMethod !== undefined && {
          pricingMethod: updates.pricingMethod,
        }),
        ...(updates.pickCount !== undefined && { pickCount: updates.pickCount }),
        ...(updates.isExclusive !== undefined && {
          isExclusive: updates.isExclusive,
        }),
        ...(updates.picksPerPeriod !== undefined && {
          picksPerPeriod: updates.picksPerPeriod,
        }),
        ...(updates.roundValues !== undefined && {
          roundValues: updates.roundValues as number[],
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
        ...(input.eventType !== undefined && { eventType: input.eventType }),
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

  async listBySportAndContestFormat(input: {
    sport: ContestConfigTemplate['sport'];
    contestFormat: ContestConfigTemplate['contestFormat'];
    eventType?: string | null;
  }): Promise<ContestConfigTemplate[]> {
    const rows = await this.prisma.contestConfigTemplate.findMany({
      where: {
        sport: input.sport,
        contestFormat: input.contestFormat,
        active: true,
        OR: [
          { eventType: input.eventType ?? null },
          { eventType: null },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
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

function mapSportEventParticipant(row: {
  id: string;
  sportEventId: string;
  participantId: string;
  isActive: boolean;
  inactiveReason: string | null;
  worldRanking: number | null;
  oddsToWin: { toNumber(): number } | number | null;
  seedNumber: number | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SportEventParticipant {
  const oddsToWin = typeof row.oddsToWin === 'number'
    ? row.oddsToWin
    : row.oddsToWin?.toNumber();

  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    isActive: row.isActive,
    inactiveReason: (row.inactiveReason as GolfParticipantInactiveReason) ?? undefined,
    worldRanking: row.worldRanking ?? undefined,
    oddsToWin: oddsToWin ?? undefined,
    seedNumber: row.seedNumber ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
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
  templateId: string | null;
  templateVersion: number | null;
  selectionType: string;
  configMode: string | null;
  configJson: unknown;
  rounds: number | null;
  timePerPickSeconds: number | null;
  autoPickPolicy: string | null;
  tierConfig: unknown;
  budget: number | null;
  pricingMethod: string | null;
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
    configMode: row.configMode as ContestConfiguration['configMode'],
    configJson: row.configJson as ContestConfiguration['configJson'],
    rounds: row.rounds ?? undefined,
    timePerPickSeconds: row.timePerPickSeconds ?? undefined,
    autoPickPolicy: row.autoPickPolicy ?? undefined,
    tierConfig: (row.tierConfig as ContestConfiguration['tierConfig']) ?? undefined,
    budget: row.budget ?? undefined,
    pricingMethod: row.pricingMethod ?? undefined,
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
  configMode: string;
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
    configMode: row.configMode as ContestConfigTemplate['configMode'],
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
