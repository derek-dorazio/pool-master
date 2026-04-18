import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestEntryParticipantScoreEventRepository,
  ContestEntryParticipantScoreRepository,
  ContestEntryPrizeAwardRepository,
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
  ContestEntryParticipantScore,
  ContestEntryParticipantScoreEvent,
  ContestEntryPrizeAward,
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

export class PrismaContestEntryParticipantScoreRepository
  implements ContestEntryParticipantScoreRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestEntryParticipantScore | null> {
    const row = await this.prisma.contestEntryParticipantScore.findUnique({
      where: { id },
    });
    return row ? mapParticipantScore(row) : null;
  }

  async findByEntry(entryId: string): Promise<ContestEntryParticipantScore[]> {
    const rows = await this.prisma.contestEntryParticipantScore.findMany({
      where: { entryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapParticipantScore);
  }

  async create(
    score: Omit<ContestEntryParticipantScore, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryParticipantScore> {
    const row = await this.prisma.contestEntryParticipantScore.create({
      data: {
        entryId: score.entryId,
        rosterPickId: score.rosterPickId,
        pointsEarned: score.pointsEarned,
      },
    });
    return mapParticipantScore(row);
  }

  async update(
    id: string,
    updates: Partial<ContestEntryParticipantScore>,
  ): Promise<ContestEntryParticipantScore> {
    const row = await this.prisma.contestEntryParticipantScore.update({
      where: { id },
      data: {
        ...(updates.pointsEarned !== undefined && {
          pointsEarned: updates.pointsEarned,
        }),
      },
    });
    return mapParticipantScore(row);
  }

  async deleteByEntry(entryId: string): Promise<number> {
    const result = await this.prisma.contestEntryParticipantScore.deleteMany({
      where: { entryId },
    });
    return result.count;
  }
}

export class PrismaContestEntryParticipantScoreEventRepository
  implements ContestEntryParticipantScoreEventRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestEntryParticipantScoreEvent | null> {
    const row = await this.prisma.contestEntryParticipantScoreEvent.findUnique({
      where: { id },
    });
    return row ? mapParticipantScoreEvent(row) : null;
  }

  async findByParticipantScore(
    contestEntryParticipantScoreId: string,
  ): Promise<ContestEntryParticipantScoreEvent[]> {
    const rows = await this.prisma.contestEntryParticipantScoreEvent.findMany({
      where: { contestEntryParticipantScoreId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapParticipantScoreEvent);
  }

  async create(
    event: Omit<
      ContestEntryParticipantScoreEvent,
      'id' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<ContestEntryParticipantScoreEvent> {
    const row = await this.prisma.contestEntryParticipantScoreEvent.create({
      data: {
        contestEntryParticipantScoreId: event.contestEntryParticipantScoreId,
        participantContestScoringRuleId: event.participantContestScoringRuleId,
        points: event.points,
        detailsJson: event.detailsJson as object,
      },
    });
    return mapParticipantScoreEvent(row);
  }

  async createMany(
    events: Omit<
      ContestEntryParticipantScoreEvent,
      'id' | 'createdAt' | 'updatedAt'
    >[],
  ): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    const result = await this.prisma.contestEntryParticipantScoreEvent.createMany({
      data: events.map((event) => ({
        contestEntryParticipantScoreId: event.contestEntryParticipantScoreId,
        participantContestScoringRuleId: event.participantContestScoringRuleId,
        points: event.points,
        detailsJson: event.detailsJson as object,
      })),
    });

    return result.count;
  }

  async deleteByParticipantScore(
    contestEntryParticipantScoreId: string,
  ): Promise<number> {
    const result = await this.prisma.contestEntryParticipantScoreEvent.deleteMany({
      where: { contestEntryParticipantScoreId },
    });
    return result.count;
  }
}

export class PrismaContestEntryPrizeAwardRepository
  implements ContestEntryPrizeAwardRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestEntryPrizeAward | null> {
    const row = await this.prisma.contestEntryPrizeAward.findUnique({
      where: { id },
    });
    return row ? mapPrizeAward(row) : null;
  }

  async findByEntry(entryId: string): Promise<ContestEntryPrizeAward[]> {
    const rows = await this.prisma.contestEntryPrizeAward.findMany({
      where: { entryId },
      orderBy: [{ awardedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapPrizeAward);
  }

  async create(
    award: Omit<ContestEntryPrizeAward, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestEntryPrizeAward> {
    const row = await this.prisma.contestEntryPrizeAward.create({
      data: {
        entryId: award.entryId,
        contestPrizeDefinitionId: award.contestPrizeDefinitionId,
        prizeDefinitionId: award.prizeDefinitionId,
        displayName: award.displayName,
        amount: award.amount,
        percentage: award.percentage,
        awardedAt: award.awardedAt,
      },
    });
    return mapPrizeAward(row);
  }

  async deleteByEntry(entryId: string): Promise<number> {
    const result = await this.prisma.contestEntryPrizeAward.deleteMany({
      where: { entryId },
    });
    return result.count;
  }
}

function mapContest(row: {
  id: string;
  leagueId: string;
  sportEventId: string | null;
  name: string;
  status: string;
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

function mapParticipantScore(row: {
  id: string;
  entryId: string;
  rosterPickId: string;
  pointsEarned: number;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntryParticipantScore {
  return {
    id: row.id,
    entryId: row.entryId,
    rosterPickId: row.rosterPickId,
    pointsEarned: row.pointsEarned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapParticipantScoreEvent(row: {
  id: string;
  contestEntryParticipantScoreId: string;
  participantContestScoringRuleId: string;
  points: number;
  detailsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntryParticipantScoreEvent {
  return {
    id: row.id,
    contestEntryParticipantScoreId: row.contestEntryParticipantScoreId,
    participantContestScoringRuleId: row.participantContestScoringRuleId,
    points: row.points,
    detailsJson: (row.detailsJson ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPrizeAward(row: {
  id: string;
  entryId: string;
  contestPrizeDefinitionId: string;
  prizeDefinitionId: string | null;
  displayName: string;
  amount: number | null;
  percentage: number | null;
  awardedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntryPrizeAward {
  return {
    id: row.id,
    entryId: row.entryId,
    contestPrizeDefinitionId: row.contestPrizeDefinitionId,
    prizeDefinitionId: row.prizeDefinitionId ?? undefined,
    displayName: row.displayName,
    amount: row.amount ?? undefined,
    percentage: row.percentage ?? undefined,
    awardedAt: row.awardedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
