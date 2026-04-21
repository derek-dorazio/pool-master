import { ContestStatus } from '@poolmaster/shared/domain';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
  SportEventParticipantSourceDataRepository,
  SportEventParticipantValuationRepository,
} from '@poolmaster/shared/db';
import {
  ContestManagementError,
  ContestManagementService,
} from '../../../packages/core-api/src/modules/contest-management/service';

function createContestCoreRepo(): ContestCoreRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Contest 1',
      status: ContestStatus.DRAFT,
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
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
    templateId: null,
    templateVersion: null,
    selectionType: 'TIERED',
    configMode: 'GOLF_TIERED',
    configJson: {
      mode: 'GOLF_TIERED',
      locksAt: '2026-04-10T12:00:00.000Z',
      maxEntriesPerSquad: 1,
      rosterSize: 6,
      countedScores: 4,
      tierSource: 'ODDS',
      tierGeneration: { defaultTierSize: 10 },
      tiers: [
        {
          tierKey: 'A',
          label: 'Tier A',
          pickCount: 1,
          startPosition: 1,
          endPosition: 10,
        },
      ],
      cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
      playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
      displayScoring: 'TO_PAR',
      tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
    },
    locksAt: new Date('2026-04-10T12:00:00.000Z'),
    maxEntriesPerSquad: 1,
    rosterSize: 6,
    pickCount: 1,
    tierConfig: [
      {
        tierKey: 'A',
        label: 'Tier A',
        pickCount: 1,
        startPosition: 1,
        endPosition: 10,
      },
    ],
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

function createContestConfigTemplateRepo(): ContestConfigTemplateRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      sport: 'GOLF',
      contestType: 'SINGLE_EVENT',
      configMode: 'GOLF_TIERED',
      templateKey: 'golf-tiered-pick-6',
      name: 'Select one from each tier, 4 count',
      description: 'Default golf tiered template',
      sortOrder: 1,
      isDefault: true,
      active: true,
      configJson: {
        mode: 'GOLF_TIERED',
        locksAt: '2026-04-10T12:00:00.000Z',
        maxEntriesPerSquad: 1,
        rosterSize: 6,
        countedScores: 4,
        tierSource: 'ODDS',
        tierGeneration: { defaultTierSize: 10 },
        tiers: [
          {
            tierKey: 'A',
            label: 'Tier A',
            pickCount: 1,
            startPosition: 1,
            endPosition: 10,
          },
        ],
        cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
      },
      schemaVersion: 1,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    }),
    listBySportAndContestType: jest.fn().mockResolvedValue([]),
  };
}

function createParticipantScoringRuleRepo(): ParticipantContestScoringRuleRepository {
  return {
    findById: jest.fn(),
    findByContestConfiguration: jest.fn().mockResolvedValue([
      {
        id: 'rule-old',
        contestConfigurationId: 'config-1',
        participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        sortOrder: 1,
        config: {},
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
      aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
      config: { topN: 4, lowerIsBetter: true },
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
        updates.aggregationDefinitionId ?? 'SUM_TOP_N_ENTRIES',
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
    findByContestConfiguration: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function createSportEventParticipantRepo(): SportEventParticipantRepository {
  return {
    findById: jest.fn(),
    findBySportEvent: jest.fn().mockResolvedValue([
      {
        id: 'sep-1',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        participantId: 'participant-1',
        status: 'ACTIVE',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: jest.fn(),
    update: jest.fn(),
  };
}

function createSportEventParticipantSourceDataRepo(): SportEventParticipantSourceDataRepository {
  return {
    findById: jest.fn(),
    findBySportEventParticipant: jest.fn().mockResolvedValue([
      {
        id: 'source-1',
        sportEventParticipantId: 'sep-1',
        providerId: 'mock-contest-feed',
        externalId: 'golfer-1',
        rawPayload: { metadata: { odds: 8.5, ranking: 1 } },
        normalizedData: { odds: 8.5, ranking: 1 },
        receivedAt: new Date('2026-04-07T12:00:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: jest.fn(),
    update: jest.fn(),
  };
}

function createSportEventParticipantValuationRepo(): SportEventParticipantValuationRepository {
  return {
    findById: jest.fn(),
    findBySportEventParticipant: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (valuation) => ({
      id: 'valuation-1',
      ...valuation,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn(),
  };
}

describe('ContestManagementService', () => {
  it('creates a golf tiered contest and derives internal scoring rules automatically', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();

    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigTemplateRepo,
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      contestEntryAggregationRuleRepo,
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Pick 6',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestType: 'SINGLE_EVENT',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
          tierSource: 'ODDS',
          tierGeneration: {
            defaultTierSize: 10,
          },
          tiers: [
            {
              tierKey: 'A',
              label: 'Tier A',
              pickCount: 1,
              startPosition: 1,
              endPosition: 10,
            },
          ],
          cutRule: {
            type: 'FIXED_SCORE',
            fixedScore: 80,
          },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: {
            type: 'PREDICT_WINNING_SCORE',
          },
        },
      },
    );

    expect(contestCoreRepo.create).toHaveBeenCalledWith({
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Masters Pick 6',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
      status: ContestStatus.OPEN,
    });
    expect(result.configuration.mode).toBe('GOLF_TIERED');
    if (result.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(result.configuration.countedScores).toBe(4);
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tierConfig: [
          expect.objectContaining({
            tierKey: 'A',
            participantIds: ['participant-1'],
          }),
        ],
      }),
    );
    expect(participantContestScoringRuleRepo.create).toHaveBeenCalledWith({
      contestConfigurationId: 'config-1',
      participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      sortOrder: 1,
      config: {
        cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
      },
      active: true,
    });
    expect(contestEntryAggregationRuleRepo.update).toHaveBeenCalledWith(
      'agg-existing',
      {
        aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
        config: { topN: 4, lowerIsBetter: true },
        active: true,
      },
    );
  });

  it('creates category contests with OPEN_SELECTION and SUM_ALL_ENTRIES aggregation', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();

    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      contestEntryAggregationRuleRepo,
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Categories',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestType: 'SINGLE_EVENT',
        configuration: {
          mode: 'GOLF_CATEGORY_PICKS',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: null,
          categories: [
            {
              categoryKey: 'ROOKIE',
              label: 'Rookie',
              pickCount: 1,
            },
          ],
          cutRule: {
            type: 'FIXED_SCORE',
            fixedScore: 80,
          },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: {
            type: 'PREDICT_WINNING_SCORE',
          },
        },
      },
    );

    expect(result.configuration.mode).toBe('GOLF_CATEGORY_PICKS');
    expect(contestCoreRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionType: 'OPEN_SELECTION',
        scoringEngine: 'STROKE_PLAY',
      }),
    );
    expect(contestEntryAggregationRuleRepo.update).toHaveBeenCalledWith(
      'agg-existing',
      {
        aggregationDefinitionId: 'SUM_ALL_ENTRIES',
        config: { lowerIsBetter: true },
        active: true,
      },
    );
  });

  it('updates the persisted typed contest configuration shape', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      contestEntryAggregationRuleRepo,
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    const result = await service.updateContestConfiguration('contest-1', {
      mode: 'GOLF_TIERED',
      locksAt: '2026-04-11T12:00:00.000Z',
      maxEntriesPerSquad: 2,
      rosterSize: 8,
      countedScores: 5,
      tierSource: 'WORLD_RANK',
      tierGeneration: {
        defaultTierSize: 10,
      },
      tiers: [
        {
          tierKey: 'A',
          label: 'Tier A',
          pickCount: 2,
          startPosition: 1,
          endPosition: 8,
        },
      ],
      cutRule: {
        type: 'FIXED_SCORE',
        fixedScore: 82,
      },
      playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
      displayScoring: 'TO_PAR',
      tiebreaker: {
        type: 'PREDICT_WINNING_SCORE',
      },
    });

    expect(contestConfigurationRepo.update).toHaveBeenCalledWith('config-1', {
      selectionType: 'TIERED',
      configMode: 'GOLF_TIERED',
      configJson: {
        mode: 'GOLF_TIERED',
        countedScores: 5,
        locksAt: '2026-04-11T12:00:00.000Z',
        maxEntriesPerSquad: 2,
        rosterSize: 8,
        tierSource: 'WORLD_RANK',
        tierGeneration: {
          defaultTierSize: 10,
        },
        tiers: [
          {
            tierKey: 'A',
            label: 'Tier A',
            pickCount: 2,
            startPosition: 1,
            endPosition: 8,
          },
        ],
        cutRule: {
          type: 'FIXED_SCORE',
          fixedScore: 82,
        },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: {
          type: 'PREDICT_WINNING_SCORE',
        },
      },
      locksAt: new Date('2026-04-11T12:00:00.000Z'),
      maxEntriesPerSquad: 2,
      tierConfig: [
        {
          tierId: 'A',
          tierKey: 'A',
          tierName: 'Tier A',
          tierNumber: 1,
          label: 'Tier A',
          pickCount: 2,
          picksFromTier: 2,
          startPosition: 1,
          endPosition: 8,
          participantIds: ['participant-1'],
        },
      ],
      pickCount: 2,
      rosterSize: 8,
      isExclusive: false,
    });
    expect(participantContestScoringRuleRepo.delete).toHaveBeenCalledWith(
      'rule-old',
    );
    if (result.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(result.configuration.rosterSize).toBe(8);
    expect(result.configuration.cutRule.fixedScore).toBe(82);
  });

  it('returns contest management detail by contest id', async () => {
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    const result = await service.getContest('contest-1');

    expect(result.id).toBe('contest-1');
    expect(result.configuration.id).toBe('config-1');
    expect(result.configuration.mode).toBe('GOLF_TIERED');
    expect(result.configuration.tiebreaker.type).toBe('PREDICT_WINNING_SCORE');
  });

  it('creates a contest from a seeded template and stores template provenance', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const contestEntryAggregationRuleRepo = createAggregationRuleRepo();

    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigTemplateRepo,
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      contestEntryAggregationRuleRepo,
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Template Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestType: 'SINGLE_EVENT',
        templateId: '11111111-1111-4111-8111-111111111111',
      },
    );

    expect(contestConfigTemplateRepo.findById).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: '11111111-1111-4111-8111-111111111111',
        templateVersion: 1,
        configMode: 'GOLF_TIERED',
      }),
    );
    expect(result.templateId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.templateVersion).toBe(1);
  });

  it('throws when a seeded template cannot be found', async () => {
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    (contestConfigTemplateRepo.findById as jest.Mock).mockResolvedValueOnce(null);

    const service = new ContestManagementService(
      createContestCoreRepo(),
      contestConfigTemplateRepo,
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    let thrown: unknown;
    try {
      await service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Missing Template Contest',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestType: 'SINGLE_EVENT',
          templateId: 'missing-template-id',
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContestManagementError);
    expect((thrown as Error).message).toBe('Contest configuration template not found');
  });

  it('throws when contest configuration is missing for an existing contest', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    (contestConfigurationRepo.findByContest as jest.Mock).mockResolvedValueOnce(null);

    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createSportEventParticipantSourceDataRepo(),
      createSportEventParticipantValuationRepo(),
    );

    let thrown: unknown;
    try {
      await service.getContest('contest-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContestManagementError);
    expect((thrown as Error).message).toBe('Contest configuration not found');
  });
});
