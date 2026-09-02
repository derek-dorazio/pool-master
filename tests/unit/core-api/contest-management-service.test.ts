import {
  ContestFormat,
  ContestStatus,
  Sport,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import type { CreateContestManagementRequest } from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestPrizeDefinitionRepository,
  ParticipantContestScoringRuleRepository,
  SportEventParticipantRepository,
} from '@poolmaster/shared/db';
import {
  ContestManagementError,
  ContestManagementService,
} from '../../../packages/core-api/src/modules/contest-management/service';
import type { GolfTierService } from '../../../packages/core-api/src/modules/golf/golf-tier-service';

const CONTEST_MANAGEMENT_TEST_NOW = new Date('2026-04-23T12:00:00.000Z');

function createContestCoreRepo(): ContestCoreRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Contest 1',
      status: ContestStatus.DRAFT,
      contestFormat: ContestFormat.ROSTER,
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
  const template = {
    id: '11111111-1111-4111-8111-111111111111',
    sport: 'GOLF',
    contestFormat: 'ROSTER',
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
    },
    schemaVersion: 1,
    createdAt: new Date('2026-04-07T12:00:00.000Z'),
    updatedAt: new Date('2026-04-07T12:00:00.000Z'),
  };

  return {
    findById: jest.fn().mockResolvedValue(template),
    list: jest.fn().mockResolvedValue([template]),
    listBySportAndContestFormat: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockImplementation(async (_id, updates) => ({
      ...template,
      ...updates,
      updatedAt: new Date('2026-04-07T12:00:01.000Z'),
    })),
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
      aggregationDefinitionId: 'SUM_ALL_ENTRIES',
      config: { lowerIsBetter: true },
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

/**
 * Defaults to reporting no tiers for the event, matching
 * assertTierConfigurationFitsTierCount's "nothing to validate against"
 * skip — the same default these fixtures relied on before tiers moved to
 * golf-tier-service (plans/124 §4.6/pool-master-piv). `withParticipants`
 * populates each tier's assignment list so the effectiveTiers echo
 * (plans/124 §5.3/pool-master-41t) can be asserted end to end.
 */
function createGolfTierServiceStub(
  tierCount = 0,
  withParticipants = false,
): GolfTierService {
  return {
    getEffectiveTiersForSportEvent: jest.fn().mockResolvedValue(
      Array.from({ length: tierCount }, (_, index) => ({
        id: `tier-${index + 1}`,
        tierKey: `tier-${index + 1}`,
        label: `Tier ${index + 1}`,
        tierNumber: index + 1,
        defaultPickCount: 1,
        participants: withParticipants
          ? [
              {
                sportEventParticipantId: `sep-${index + 1}`,
                participantId: `golfer-${index + 1}`,
                tierOrderIndex: index + 1,
                price: null,
              },
            ]
          : [],
      })),
    ),
  } as unknown as GolfTierService;
}

function createSportEventReader(overrides?: Partial<{
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  sport: Sport;
  tournamentFormat: TournamentFormat;
  participantCount: number | null;
  loadedParticipantCount: number;
}>): {
  findById: jest.Mock;
} {
  return {
    findById: jest.fn().mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      releaseAt: overrides?.releaseAt ?? new Date('2026-04-22T12:00:00.000Z'),
      fieldLocksAt: overrides?.fieldLocksAt ?? new Date('2026-05-10T12:00:00.000Z'),
      fieldLocked: overrides?.fieldLocked ?? false,
      sport: overrides?.sport ?? Sport.GOLF,
      tournamentFormat:
        overrides?.tournamentFormat ?? TournamentFormat.STROKE_PLAY_TOURNAMENT,
      participantCount: overrides?.participantCount ?? 72,
      loadedParticipantCount: overrides?.loadedParticipantCount ?? 72,
    }),
  };
}

describe('ContestManagementService', () => {
  beforeAll(() => {
    // Defect pool-master-mmj: keep event readiness dates stable after the 2026 field lock date passes.
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Pick 6',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
        },
      },
    );

    expect(contestCoreRepo.create).toHaveBeenCalledWith({
      leagueId: 'league-1',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      name: 'Masters Pick 6',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
      contestFormat: ContestFormat.ROSTER,
      status: ContestStatus.OPEN,
    });
    expect(result.configuration.mode).toBe('GOLF_TIERED');
    if (result.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(result.configuration.countedScores).toBe(4);
    // pool-master-41t — the create response also carries the read-only
    // effectiveTiers echo (plans/124 §5.3), empty for an event with no tiers.
    expect(result.effectiveTiers).toEqual([]);
    // pool-master-p15 — tiers are event-owned now (plans/124 §4.6); contest
    // creation no longer computes or persists a per-contest tierConfig
    // snapshot, so the create call carries no tierConfig key at all.
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tierConfig: expect.anything(),
      }),
    );
    // pool-master-piv — cutRule/playoffHandling/displayScoring/tiebreaker
    // dropped (plans/124 §4.6a): each was locked to one possible value with
    // zero real reads downstream, so the config blob is now empty.
    expect(participantContestScoringRuleRepo.create).toHaveBeenCalledWith({
      contestConfigurationId: 'config-1',
      participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      sortOrder: 1,
      config: {},
      active: true,
    });
    expect(contestEntryAggregationRuleRepo.update).toHaveBeenCalledWith(
      'agg-existing',
      {
        aggregationDefinitionId: 'SUM_ALL_ENTRIES',
        config: { lowerIsBetter: true },
        active: true,
      },
    );
  });

  it('pool-master-piv rejects a tiered contest whose rosterSize does not divide evenly across the event\'s tiers', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(2),
      undefined,
      createSportEventReader({
        participantCount: 80,
        loadedParticipantCount: 80,
      }),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Invalid tiers',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
          configuration: {
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 3,
            rosterSize: 5,
            countedScores: 4,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      message: 'rosterSize (5) must divide evenly across the event\'s 2 tier(s).',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('pool-master-piv rejects a tiered contest whose countedScores exceeds rosterSize', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(2),
      undefined,
      createSportEventReader({
        participantCount: 80,
        loadedParticipantCount: 80,
      }),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Invalid counted scores',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
          configuration: {
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 3,
            rosterSize: 4,
            countedScores: 6,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      message: 'countedScores (6) cannot exceed rosterSize (4).',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('pool-master-rop.78.14 rejects contest creation when the event sport does not allow the requested format', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader({ sport: Sport.GOLF }),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Invalid bracket',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: ContestFormat.BRACKET,
          configuration: {
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 3,
            rosterSize: 4,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: {
              defaultTierSize: 10,
            },
            tiers: [
              {
                tierKey: 'A',
                label: 'Tier A',
                pickCount: 4,
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
        } as unknown as CreateContestManagementRequest,
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_FORMAT_NOT_ALLOWED',
      message: 'Selected sporting event does not support that contest format.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('pool-master-rop.78.14 rejects valid future formats until creation support exists', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader({
        sport: Sport.NCAA_BASKETBALL,
        tournamentFormat: TournamentFormat.KNOCKOUT_BRACKET,
      }),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Bracket Pool',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: ContestFormat.BRACKET,
          configuration: {
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 3,
            rosterSize: 4,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: {
              defaultTierSize: 10,
            },
            tiers: [
              {
                tierKey: 'A',
                label: 'Tier A',
                pickCount: 4,
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
        } as unknown as CreateContestManagementRequest,
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_FORMAT_NOT_SUPPORTED',
      message: 'This contest format is not available for managed contest creation yet.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('pool-master-rop.78.14 rejects non-golf managed creation until sport-specific configs exist', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader({
        sport: Sport.NCAA_BASKETBALL,
        tournamentFormat: TournamentFormat.KNOCKOUT_BRACKET,
      }),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Basketball Roster Pool',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: ContestFormat.ROSTER,
          configuration: {
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 3,
            rosterSize: 4,
            countedScores: 4,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_SPORT_NOT_SUPPORTED',
      message: 'Managed contest creation currently supports golf events only.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.updateContestConfiguration('contest-1', {
      mode: 'GOLF_TIERED',
      locksAt: '2026-04-11T12:00:00.000Z',
      maxEntriesPerSquad: 2,
      rosterSize: 8,
      countedScores: 5,
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
      },
      locksAt: new Date('2026-04-11T12:00:00.000Z'),
      maxEntriesPerSquad: 2,
      pickCount: 8,
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
    expect(result.configuration.countedScores).toBe(5);
    // pool-master-41t — the refreshed detail carries the read-only
    // effectiveTiers echo (plans/124 §5.3).
    expect(result.effectiveTiers).toEqual([]);
  });

  it('pool-master-piv rejects a tiered contest update whose rosterSize does not divide evenly across the event\'s tiers', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(2),
      undefined,
      createSportEventReader({
        participantCount: 80,
        loadedParticipantCount: 80,
      }),
    );

    await expect(
      service.updateContestConfiguration('contest-1', {
        mode: 'GOLF_TIERED',
        locksAt: '2026-04-11T12:00:00.000Z',
        maxEntriesPerSquad: 2,
        rosterSize: 5,
        countedScores: 4,
      }),
    ).rejects.toMatchObject({
      code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      message: 'rosterSize (5) must divide evenly across the event\'s 2 tier(s).',
    });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.getContest('contest-1');

    expect(result.id).toBe('contest-1');
    expect(result.configuration.id).toBe('config-1');
    expect(result.configuration.mode).toBe('GOLF_TIERED');
    if (result.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(result.configuration.countedScores).toBe(4);
    // pool-master-41t — the detail response always carries the read-only
    // effectiveTiers echo (plans/124 §5.3); empty here because this event
    // has no tiers defined.
    expect(result.effectiveTiers).toEqual([]);
  });

  it('pool-master-41t echoes the linked event\'s effective tiers read-only on the management detail', async () => {
    const golfTierService = createGolfTierServiceStub(2, true);
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      golfTierService,
      undefined,
      createSportEventReader(),
    );

    const result = await service.getContest('contest-1');

    expect(golfTierService.getEffectiveTiersForSportEvent).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(result.effectiveTiers).toEqual([
      {
        tierKey: 'tier-1',
        label: 'Tier 1',
        tierNumber: 1,
        defaultPickCount: 1,
        assignments: [
          {
            sportEventParticipantId: 'sep-1',
            participantId: 'golfer-1',
            tierOrderIndex: 1,
            price: null,
          },
        ],
      },
      {
        tierKey: 'tier-2',
        label: 'Tier 2',
        tierNumber: 2,
        defaultPickCount: 1,
        assignments: [
          {
            sportEventParticipantId: 'sep-2',
            participantId: 'golfer-2',
            tierOrderIndex: 2,
            price: null,
          },
        ],
      },
    ]);
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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Template Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    let thrown: unknown;
    try {
      await service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Missing Template Contest',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
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
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader(),
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

  it('rejects contest creation when the sporting event field has not loaded yet', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader({
        participantCount: 72,
        loadedParticipantCount: 0,
      }),
    );

    await expect(service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Missing Field Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
        },
      },
    )).rejects.toMatchObject({
      code: 'SPORT_EVENT_FIELD_NOT_LOADED',
      message: 'Selected sporting event field has not loaded yet.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('rejects contest creation when the sporting event is not released yet', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createAggregationRuleRepo(),
      createPrizeDefinitionRepo(),
      createSportEventParticipantRepo(),
      createGolfTierServiceStub(),
      undefined,
      createSportEventReader({
        releaseAt: new Date('2026-05-10T12:00:00.000Z'),
        loadedParticipantCount: 72,
      }),
    );

    await expect(service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Unreleased Event Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
        },
      },
    )).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_RELEASED',
      message: 'Selected sporting event is not released for contest creation yet.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});
