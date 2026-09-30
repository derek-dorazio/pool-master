import {
  ContestFormat,
  ContestStatus,
  Sport,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_CONFIGURATION_SETTLED,
  type CreateContestRequest,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import {
  ContestManagementError,
  ContestManagementService,
} from '../../../packages/core-api/src/modules/contest-management/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  fakeContestCoreRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';

const CONTEST_MANAGEMENT_TEST_NOW = new Date('2026-04-23T12:00:00.000Z');

function createContestCoreRepo(): ContestCoreRepository {
  return fakeContestCoreRepo({
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
    create: jest.fn().mockImplementation(async (contest) => ({
      id: 'contest-1',
      ...contest,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    })),
  });
}

// NOT migrated to tests/support/repo-fakes.ts (#208), deliberately. This is a stateful
// in-memory stub, not a fake: it holds a mutable `state` so the service can read back what
// it wrote. The shared builders exist to remove duplicated METHOD LISTS; replacing this
// with neutral defaults would delete the behaviour the test depends on.
function createContestConfigurationRepo(): ContestConfigurationRepository {
  const state = {
    id: 'config-1',
    contestId: 'contest-1',
    templateId: null,
    templateVersion: null,
    selectionType: 'TIERED',
    configJson: {
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
    selectionType: 'TIERED',
    templateKey: 'golf-tiered-pick-6',
    name: 'Select one from each tier, 4 count',
    description: 'Default golf tiered template',
    sortOrder: 1,
    isDefault: true,
    active: true,
    configJson: {
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
    update: jest.fn().mockImplementation(async (_id, updates) => ({
      ...template,
      ...updates,
      updatedAt: new Date('2026-04-07T12:00:01.000Z'),
    })),
  };
}

function createParticipantScoringRuleRepo(): ParticipantContestScoringRuleRepository {
  return fakeParticipantContestScoringRuleRepo({
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
  });
}

/**
 * Defaults to reporting no tiers for the event, matching
 * assertTierConfigurationFitsTierCount's "nothing to validate against"
 * skip — the same default these fixtures relied on before tiers moved to
 * SportEventTierService (plans/124 §4.6/pool-master-piv). `withParticipants`
 * populates each tier's assignment list so the effectiveTiers echo
 * (plans/124 §5.3/pool-master-41t) can be asserted end to end.
 */
function createSportEventTierServiceStub(
  tierCount = 0,
  withParticipants = false,
): SportEventTierService {
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
  } as unknown as SportEventTierService;
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

    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigTemplateRepo,
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Pick 6',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
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
    expect(result).toBe('contest-1');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: undefined,
        selectionType: 'TIERED',
        configJson: expect.objectContaining({ rosterSize: 6, countedScores: 4, maxEntriesPerSquad: 3 }),
      }),
    );
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
  });

  it('pool-master-piv rejects a tiered contest whose rosterSize does not divide evenly across the event\'s tiers', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(2),
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
          selectionType: 'TIERED',
          configuration: {
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
      createSportEventTierServiceStub(2),
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
          selectionType: 'TIERED',
          configuration: {
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
      createSportEventTierServiceStub(),
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
          selectionType: 'TIERED',
          configuration: {
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
        } as unknown as CreateContestRequest,
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
      createSportEventTierServiceStub(),
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
          selectionType: 'TIERED',
          configuration: {
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
        } as unknown as CreateContestRequest,
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
      createSportEventTierServiceStub(),
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
          selectionType: 'TIERED',
          configuration: {
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

  // #246 — a settled contest's configuration is frozen with its result; reopening is the path back.
  it('refuses a configuration edit while the contest is COMPLETED, and allows it once reopened', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );
    const contest = await contestCoreRepo.findById('contest-1');
    const edit = { rosterSize: 6, countedScores: 5 };

    (contestCoreRepo.findById as jest.Mock).mockResolvedValueOnce({ ...contest, status: ContestStatus.COMPLETED });
    await expect(service.updateContestConfiguration('contest-1', edit)).rejects.toMatchObject({
      code: CONTEST_CONFIGURATION_SETTLED,
      statusCode: 409,
    });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();

    // OverrideService.reopenContest moves COMPLETED → ACTIVE; the edit then goes through.
    (contestCoreRepo.findById as jest.Mock).mockResolvedValueOnce({ ...contest, status: ContestStatus.ACTIVE });
    await service.updateContestConfiguration('contest-1', edit);
    expect(contestConfigurationRepo.update).toHaveBeenCalledTimes(1);
  });

  it('updates the persisted typed contest configuration shape', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.updateContestConfiguration('contest-1', {
      locksAt: '2026-04-11T12:00:00.000Z',
      maxEntriesPerSquad: 2,
      rosterSize: 8,
      countedScores: 5,
    });

    // #245 — an update never rewrites selectionType: it is fixed at create, and the
    // mapSelectionType echo that re-derived it on every save is gone.
    expect(contestConfigurationRepo.update).toHaveBeenCalledWith('config-1', {
      configJson: {
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
      createSportEventTierServiceStub(2),
      undefined,
      createSportEventReader({
        participantCount: 80,
        loadedParticipantCount: 80,
      }),
    );

    await expect(
      service.updateContestConfiguration('contest-1', {
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
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.getContest('contest-1');

    expect(result.id).toBe('contest-1');
    expect(result.configuration.id).toBe('config-1');
    expect(result.configuration.countedScores).toBe(4);
    // pool-master-41t — the detail response always carries the read-only
    // effectiveTiers echo (plans/124 §5.3); empty here because this event
    // has no tiers defined.
    expect(result.effectiveTiers).toEqual([]);
  });

  it('pool-master-41t echoes the linked event\'s effective tiers read-only on the management detail', async () => {
    const golfTierService = createSportEventTierServiceStub(2, true);
    const service = new ContestManagementService(
      createContestCoreRepo(),
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
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

    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigTemplateRepo,
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Template Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
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
      }),
    );
    // With no configuration supplied, the template's configuration is the contest's.
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configJson: expect.objectContaining({ rosterSize: 6, countedScores: 4, maxEntriesPerSquad: 1 }),
      }),
    );
    expect(result).toBe('contest-1');
  });

  // #245 — template and configuration together: the template is provenance, the supplied
  // configuration replaces the template's whole.
  it('creates from a template with a supplied configuration replacing the template configuration', async () => {
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      createContestCoreRepo(),
      contestConfigTemplateRepo,
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    await service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Masters Template Override',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateId: '11111111-1111-4111-8111-111111111111',
        configuration: {
          rosterSize: 12,
          countedScores: 8,
        },
      },
    );

    const [createInput] = (contestConfigurationRepo.create as jest.Mock).mock.calls[0] as [
      { templateId: string; templateVersion: number; configJson: Record<string, unknown> },
    ];
    expect(createInput.templateId).toBe('11111111-1111-4111-8111-111111111111');
    expect(createInput.templateVersion).toBe(1);
    // Replaced whole, not merged: the template's maxEntriesPerSquad does not survive.
    expect(createInput.configJson).toEqual({ rosterSize: 12, countedScores: 8 });
  });

  // #245 — neither a template nor a configuration: the service holds the rule even without the
  // route's refine in front of it.
  it('rejects a create naming neither a template nor a configuration', async () => {
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Empty create',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
        },
      ),
    ).rejects.toMatchObject({ code: CONTEST_CONFIGURATION_REQUIRED, statusCode: 400 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  // #245 — the request's selectionType is authoritative; a template of another selection
  // type is refused rather than silently winning.
  it('rejects a template whose selection type differs from the request', async () => {
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const template = await contestConfigTemplateRepo.findById('any');
    (contestConfigTemplateRepo.findById as jest.Mock).mockResolvedValueOnce({
      ...template,
      selectionType: 'BUDGET_PICK',
    });
    const contestCoreRepo = createContestCoreRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      contestConfigTemplateRepo,
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Mismatched template',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          templateId: '11111111-1111-4111-8111-111111111111',
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_CONFIGURATION_INVALID',
      message: 'Contest configuration template does not match the requested selection type',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('throws when a seeded template cannot be found', async () => {
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    (contestConfigTemplateRepo.findById as jest.Mock).mockResolvedValueOnce(null);

    const service = new ContestManagementService(
      createContestCoreRepo(),
      contestConfigTemplateRepo,
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
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
          selectionType: 'TIERED',
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
      createSportEventTierServiceStub(),
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
      createSportEventTierServiceStub(),
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
        selectionType: 'TIERED',
        configuration: {
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
      createSportEventTierServiceStub(),
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
        selectionType: 'TIERED',
        configuration: {
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
