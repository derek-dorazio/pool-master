import { ContestStatus } from '@poolmaster/shared/domain';
import type {
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import { ContestManagementService } from '../../../packages/core-api/src/modules/contest-management/service';

function createContestCoreRepo(): ContestCoreRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Contest 1',
      status: ContestStatus.DRAFT,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    }),
    findByLeague: jest.fn(),
    create: jest.fn().mockImplementation(async (contest) => ({
      id: 'contest-1',
      ...contest,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    })),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function createContestConfigurationRepo(): ContestConfigurationRepository {
  const state = {
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: 'BUDGET_PICK',
    locksAt: undefined as Date | undefined,
    minimumEntries: 1,
    maxEntriesPerSquad: 1,
    rosterSize: 6,
    totalPrizePoolAmount: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    findById: jest.fn(),
    findByContest: jest.fn().mockImplementation(async () => ({ ...state })),
    create: jest.fn().mockImplementation(async (configuration) => {
      Object.assign(state, configuration, {
        id: 'config-1',
        createdAt: new Date('2026-04-07T12:00:01.000Z'),
        updatedAt: new Date('2026-04-07T12:00:01.000Z'),
      });
      return { ...state };
    }),
    update: jest.fn().mockImplementation(async (_id, updates) => {
      Object.assign(state, updates, {
        updatedAt: new Date('2026-04-07T12:00:02.000Z'),
      });
      return { ...state };
    }),
  };
}

function createParticipantScoringRuleRepo(): ParticipantContestScoringRuleRepository {
  return {
    findById: jest.fn(),
    findByContestConfiguration: jest.fn().mockResolvedValue([
      {
        id: 'rule-old',
        contestConfigurationId: 'config-1',
        participantScoringDefinitionId: 'TEAM_WIN_POINTS',
        sortOrder: 1,
        config: { pointsPerWin: 1 },
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: jest.fn().mockImplementation(async (rule) => ({
      id: `rule-${rule.sortOrder}`,
      ...rule,
      createdAt: new Date('2026-04-07T12:00:02.000Z'),
      updatedAt: new Date('2026-04-07T12:00:02.000Z'),
    })),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function createAggregationRuleRepo(): ContestEntryAggregationRuleRepository {
  return {
    findById: jest.fn(),
    findByContestConfiguration: jest.fn().mockResolvedValue({
      id: 'agg-existing',
      contestConfigurationId: 'config-1',
      aggregationDefinitionId: 'SUM_ALL_ENTRIES',
      config: {},
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    create: jest.fn().mockImplementation(async (rule) => ({
      id: 'agg-1',
      ...rule,
      createdAt: new Date('2026-04-07T12:00:03.000Z'),
      updatedAt: new Date('2026-04-07T12:00:03.000Z'),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      contestConfigurationId: 'config-1',
      aggregationDefinitionId:
        updates.aggregationDefinitionId ?? 'SUM_ALL_ENTRIES',
      config: updates.config ?? {},
      active: updates.active ?? true,
      createdAt: new Date('2026-04-07T12:00:03.000Z'),
      updatedAt: new Date('2026-04-07T12:00:03.000Z'),
    })),
  };
}

function createPrizeDefinitionRepo(): ContestPrizeDefinitionRepository {
  return {
    findById: jest.fn(),
    findByContestConfiguration: jest.fn().mockResolvedValue([
      {
        id: 'prize-old',
        contestConfigurationId: 'config-1',
        prizeDefinitionId: 'FINAL_PLACE',
        displayName: 'Old Prize',
        sortOrder: 1,
        ruleConfig: { place: 1 },
        payoutType: 'PERCENTAGE',
        percentage: 50,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: jest.fn().mockImplementation(async (definition) => ({
      id: `prize-${definition.sortOrder}`,
      ...definition,
      createdAt: new Date('2026-04-07T12:00:04.000Z'),
      updatedAt: new Date('2026-04-07T12:00:04.000Z'),
    })),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

describe('ContestManagementService', () => {
  it('creates a contest with configuration, scoring rules, aggregation rule, and prize definitions', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();
    const contestPrizeDefinitionRepo = createPrizeDefinitionRepo();

    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      contestEntryAggregationRuleRepo,
      contestPrizeDefinitionRepo,
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Pick 6',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestType: 'SINGLE_EVENT',
        configuration: {
          selectionType: 'BUDGET_PICK',
          locksAt: '2026-04-10T12:00:00.000Z',
          minimumEntries: 2,
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          totalPrizePoolAmount: 500,
          participantScoringRules: [
            {
              participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
              sortOrder: 1,
              config: { missedCutPenalty: 10 },
              active: true,
            },
          ],
          entryAggregationRule: {
            aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
            config: { topN: 4, lowerIsBetter: true },
            active: true,
          },
          prizeDefinitions: [
            {
              prizeDefinitionId: 'FINAL_PLACE',
              displayName: 'First Place',
              sortOrder: 1,
              ruleConfig: { place: 1 },
              payoutType: 'PERCENTAGE',
              percentage: 50,
              active: true,
            },
          ],
        },
      },
    );

    expect(contestCoreRepo.create).toHaveBeenCalledWith({
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Masters Pick 6',
      status: ContestStatus.DRAFT,
    });
    expect(result.configuration.participantScoringRules).toHaveLength(1);
    expect(result.configuration.entryAggregationRule.aggregationDefinitionId).toBe(
      'SUM_TOP_N_ENTRIES',
    );
    expect(result.configuration.prizeDefinitions[0]).toMatchObject({
      prizeDefinitionId: 'FINAL_PLACE',
      displayName: 'First Place',
      percentage: 50,
    });
  });

  it('rejects duplicate sortOrder values in participant scoring rules', async () => {
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Contest',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestType: 'SINGLE_EVENT',
          configuration: {
            selectionType: 'BUDGET_PICK',
            participantScoringRules: [
              {
                participantScoringDefinitionId: 'TEAM_WIN_POINTS',
                sortOrder: 1,
                config: { pointsPerWin: 1 },
                active: true,
              },
              {
                participantScoringDefinitionId: 'ROUND_MULTIPLIER',
                sortOrder: 1,
                config: { roundMultipliers: { '1': 1 } },
                active: true,
              },
            ],
            entryAggregationRule: {
              aggregationDefinitionId: 'SUM_ALL_ENTRIES',
              config: {},
              active: true,
            },
            prizeDefinitions: [],
          },
        },
      ),
    ).rejects.toThrow(
      'Participant scoring rules must have unique sortOrder values',
    );
  });

  it('rejects invalid prize payout configuration', async () => {
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Contest',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestType: 'SINGLE_EVENT',
          configuration: {
            selectionType: 'BUDGET_PICK',
            participantScoringRules: [
              {
                participantScoringDefinitionId: 'TEAM_WIN_POINTS',
                sortOrder: 1,
                config: { pointsPerWin: 1 },
                active: true,
              },
            ],
            entryAggregationRule: {
              aggregationDefinitionId: 'SUM_ALL_ENTRIES',
              config: {},
              active: true,
            },
            prizeDefinitions: [
              {
                prizeDefinitionId: 'FINAL_PLACE',
                displayName: 'First Place',
                sortOrder: 1,
                ruleConfig: { place: 1 },
                payoutType: 'FIXED_AMOUNT',
                active: true,
              },
            ],
          },
        },
      ),
    ).rejects.toThrow(
      'Prize definition First Place requires amount for FIXED_AMOUNT payouts',
    );
  });

  it('updates the persisted contest configuration shape', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();
    const contestPrizeDefinitionRepo = createPrizeDefinitionRepo();
    const service = new ContestManagementService(
      createContestCoreRepo(),
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      contestEntryAggregationRuleRepo,
      contestPrizeDefinitionRepo,
    );

    const result = await service.updateContestConfiguration('contest-1', {
      selectionType: 'TIERED',
      locksAt: '2026-04-11T12:00:00.000Z',
      minimumEntries: 3,
      maxEntriesPerSquad: 2,
      rosterSize: 8,
      totalPrizePoolAmount: 1000,
      participantScoringRules: [
        {
          participantScoringDefinitionId: 'TEAM_WIN_POINTS',
          sortOrder: 1,
          config: { pointsPerWin: 2 },
          active: true,
        },
      ],
      entryAggregationRule: {
        aggregationDefinitionId: 'SUM_ALL_ENTRIES',
        config: {},
        active: true,
      },
      prizeDefinitions: [],
    });

    expect(contestConfigurationRepo.update).toHaveBeenCalledWith('config-1', {
      selectionType: 'TIERED',
      locksAt: new Date('2026-04-11T12:00:00.000Z'),
      minimumEntries: 3,
      maxEntriesPerSquad: 2,
      rosterSize: 8,
      totalPrizePoolAmount: 1000,
    });
    expect(participantContestScoringRuleRepo.delete).toHaveBeenCalledWith('rule-old');
    expect(contestEntryAggregationRuleRepo.update).toHaveBeenCalledWith(
      'agg-existing',
      {
        aggregationDefinitionId: 'SUM_ALL_ENTRIES',
        config: {},
        active: true,
      },
    );
    expect(contestPrizeDefinitionRepo.delete).toHaveBeenCalledWith('prize-old');
    expect(result.configuration.rosterSize).toBe(8);
  });

  it('returns contest management detail by contest id', async () => {
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
    );

    const result = await service.getContest('contest-1');

    expect(result.id).toBe('contest-1');
    expect(result.configuration.id).toBe('config-1');
    expect(result.configuration.participantScoringRules[0]?.id).toBe('rule-old');
    expect(result.configuration.entryAggregationRule.id).toBe('agg-existing');
    expect(result.configuration.prizeDefinitions[0]?.id).toBe('prize-old');
  });
});
