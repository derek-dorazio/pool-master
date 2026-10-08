import { expect } from '@jest/globals';
import {
  ContestFormat,
  ContestStatus,
  SelectionType,
  Sport,
  SportEventStatus,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_NOT_DRAFT,
  type CreateContestRequest,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestRepository,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import {
  ContestManagementError,
  ContestManagementService,
} from '../../../packages/core-api/src/modules/contest-management/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  fakeContestRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

const CONTEST_MANAGEMENT_TEST_NOW = new Date('2026-04-23T12:00:00.000Z');

function createContestRepo(): ContestRepository {
  return fakeContestRepo({
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
    create: mockFn<ContestRepository['create']>(async (contest) => ({
      id: 'contest-1',
      isExclusive: false,
      scoringStopsOnElimination: false,
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
      maxEntriesPerSquad: 1,
      picksPerTier: 1,
      countedScores: 4,
    },
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
    sport: Sport.GOLF,
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    templateKey: 'golf-tiered-pick-6',
    name: 'Select one from each tier, 4 count',
    description: 'Default golf tiered template',
    sortOrder: 1,
    isDefault: true,
    active: true,
    configJson: {
      maxEntriesPerSquad: 1,
      picksPerTier: 1,
      countedScores: 4,
    },
    schemaVersion: 1,
    createdAt: new Date('2026-04-07T12:00:00.000Z'),
    updatedAt: new Date('2026-04-07T12:00:00.000Z'),
  };

  return {
    findById: jest.fn().mockResolvedValue(template),
    list: jest.fn().mockResolvedValue([template]),
    update: mockFn<ContestConfigTemplateRepository['update']>(async (_id, updates) => ({
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
    create: mockFn<ParticipantContestScoringRuleRepository['create']>(async (rule) => ({
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
  status: SportEventStatus;
  startDate: Date;
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
      status: overrides?.status ?? SportEventStatus.SCHEDULED,
      startDate: overrides?.startDate ?? new Date('2026-05-14T12:00:00.000Z'),
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

  it('creates a golf tiered contest as a DRAFT and derives internal scoring rules automatically', async () => {
    const contestCoreRepo = createContestRepo();
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
          maxEntriesPerSquad: 3,
          picksPerTier: 1,
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
      status: ContestStatus.DRAFT,
    });
    expect(result).toBe('contest-1');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: undefined,
        selectionType: 'TIERED',
        // configJson holds only GolfContestConfig's own fields; the entry cap has its column (#416).
        configJson: { picksPerTier: 1, countedScores: 4 },
        maxEntriesPerSquad: 3,
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

  it('refuses to create a tiered contest whose countedScores exceeds the event\'s tier count times picksPerTier, writing nothing', async () => {
    const contestCoreRepo = createContestRepo();
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
            maxEntriesPerSquad: 3,
            picksPerTier: 2,
            countedScores: 5,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      message: 'countedScores (5) cannot exceed the roster of 4 (2 tier(s) × 2 pick(s) per tier).',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('creates a tiered contest whose countedScores equals the event\'s tier count times picksPerTier, storing picksPerTier and no roster size', async () => {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
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
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Every pick counts',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          configuration: {
            maxEntriesPerSquad: 3,
            picksPerTier: 2,
            countedScores: 4,
          },
        },
      ),
    ).resolves.toBe('contest-1');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ configJson: { picksPerTier: 2, countedScores: 4 } }),
    );
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ rosterSize: expect.anything() }),
    );
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ pickCount: expect.anything() }),
    );
  });

  it('pool-master-rop.78.14 rejects contest creation when the event sport does not allow the requested format', async () => {
    const contestCoreRepo = createContestRepo();
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
            maxEntriesPerSquad: 3,
            picksPerTier: 1,
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
    const contestCoreRepo = createContestRepo();
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
            maxEntriesPerSquad: 3,
            picksPerTier: 1,
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
    const contestCoreRepo = createContestRepo();
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
            maxEntriesPerSquad: 3,
            picksPerTier: 1,
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
  it.each([
    ContestStatus.OPEN,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
  ])('refuses a configuration edit with 409 CONTEST_CONFIGURATION_LOCKED once the contest is %s, writing nothing', async (status) => {
    const contestCoreRepo = createContestRepo();
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

    (contestCoreRepo.findById as jest.Mock).mockResolvedValueOnce({ ...contest, status });
    await expect(
      service.updateContestConfiguration('contest-1', { picksPerTier: 1, countedScores: 5 }),
    ).rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });

  describe('openContest', () => {
    function buildService(options?: {
      status?: ContestStatus;
      leagueId?: string;
      tierCount?: number;
      reader?: ReturnType<typeof createSportEventReader>;
      transitioned?: boolean;
    }) {
      const contestCoreRepo = createContestRepo();
      const draft = {
        id: 'contest-1',
        leagueId: options?.leagueId ?? 'league-1',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        name: 'Contest 1',
        status: options?.status ?? ContestStatus.DRAFT,
        contestFormat: ContestFormat.ROSTER,
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      };
      (contestCoreRepo.findById as jest.Mock).mockResolvedValue(draft);
      (contestCoreRepo.transitionStatus as jest.Mock).mockImplementation(async () => {
        if (options?.transitioned === false) {
          return false;
        }
        draft.status = ContestStatus.OPEN;
        return true;
      });
      const service = new ContestManagementService(
        contestCoreRepo,
        createContestConfigTemplateRepo(),
        createContestConfigurationRepo(),
        createParticipantScoringRuleRepo(),
        createSportEventTierServiceStub(options?.tierCount ?? 0),
        undefined,
        options?.reader ?? createSportEventReader(),
        () => CONTEST_MANAGEMENT_TEST_NOW,
      );
      return { service, contestCoreRepo };
    }

    it('moves a DRAFT contest to OPEN with a compare-and-set from DRAFT, and returns it open', async () => {
      const { service, contestCoreRepo } = buildService();

      const opened = await service.openContest('league-1', 'contest-1');

      expect(contestCoreRepo.transitionStatus).toHaveBeenCalledWith('contest-1', {
        from: [ContestStatus.DRAFT],
        to: ContestStatus.OPEN,
      });
      expect(opened.status).toBe(ContestStatus.OPEN);
    });

    it.each([
      ContestStatus.OPEN,
      ContestStatus.ACTIVE,
      ContestStatus.COMPLETED,
    ])('refuses a %s contest with 409 CONTEST_NOT_DRAFT and moves nothing', async (status) => {
      const { service, contestCoreRepo } = buildService({ status });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: CONTEST_NOT_DRAFT, statusCode: 409 });
      expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    });

    it('answers 409 CONTEST_NOT_DRAFT when a concurrent press already moved the contest', async () => {
      const { service } = buildService({ transitioned: false });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: CONTEST_NOT_DRAFT, statusCode: 409 });
    });

    it('refuses a contest from another league as not found, so one league\'s commissioner cannot open another\'s', async () => {
      const { service, contestCoreRepo } = buildService({ leagueId: 'league-2' });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
      expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    });

    it('refuses with 409 CONTEST_EVENT_ALREADY_STARTED once the event start time has passed, even while it is still SCHEDULED', async () => {
      const { service, contestCoreRepo } = buildService({
        reader: createSportEventReader({ startDate: new Date('2026-04-23T11:59:59.000Z') }),
      });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: CONTEST_EVENT_ALREADY_STARTED, statusCode: 409 });
      expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    });

    it.each([
      SportEventStatus.IN_PROGRESS,
      SportEventStatus.COMPLETED,
      SportEventStatus.CANCELLED,
    ])('refuses with 409 CONTEST_EVENT_ALREADY_STARTED when the event is %s, even before its start time', async (status) => {
      const { service, contestCoreRepo } = buildService({ reader: createSportEventReader({ status }) });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: CONTEST_EVENT_ALREADY_STARTED, statusCode: 409 });
      expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    });

    it('opens a contest on a POSTPONED event, which has not started', async () => {
      const { service } = buildService({
        reader: createSportEventReader({ status: SportEventStatus.POSTPONED }),
      });

      await expect(service.openContest('league-1', 'contest-1'))
        .resolves.toMatchObject({ status: ContestStatus.OPEN });
    });

    it('refuses with 422 CONTEST_TIER_FIELD_OUT_OF_RANGE when the event\'s tiers no longer hold the stored countedScores', async () => {
      // The stored configuration counts 4 scores at 1 pick per tier; an event with 3 tiers
      // gives a roster of 3, too few to count 4.
      const { service, contestCoreRepo } = buildService({ tierCount: 3 });

      await expect(service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE', statusCode: 422 });
      expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    });
  });

  it('updates the persisted typed contest configuration shape', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const service = new ContestManagementService(
      createContestRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      participantContestScoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.updateContestConfiguration('contest-1', {
      maxEntriesPerSquad: 2,
      picksPerTier: 2,
      countedScores: 5,
    });

    // configJson stores only GolfContestConfig's two fields; maxEntriesPerSquad has its own
    // column, so a JSON copy could only drift from it (#416).
    const storedConfigJson = {
      countedScores: 5,
      picksPerTier: 2,
    };
    // #245 — an update never rewrites selectionType: it is fixed at create, and the
    // mapSelectionType echo that re-derived it on every save is gone. #479 — the roster is
    // derived from the event's tiers, so no rosterSize or pickCount column is written.
    expect(contestConfigurationRepo.update).toHaveBeenCalledWith('config-1', {
      configJson: storedConfigJson,
      maxEntriesPerSquad: 2,
      isExclusive: false,
    });
    expect(participantContestScoringRuleRepo.delete).toHaveBeenCalledWith(
      'rule-old',
    );
    expect(result.configuration.picksPerTier).toBe(2);
    expect(result.configuration.countedScores).toBe(5);
    // pool-master-41t — the refreshed detail carries the read-only
    // effectiveTiers echo (plans/124 §5.3).
    expect(result.effectiveTiers).toEqual([]);
  });

  it('refuses a tiered contest update whose countedScores exceeds the event\'s tier count times picksPerTier, writing nothing', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      createContestRepo(),
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
        maxEntriesPerSquad: 2,
        picksPerTier: 1,
        countedScores: 3,
      }),
    ).rejects.toMatchObject({
      code: 'CONTEST_TIER_FIELD_OUT_OF_RANGE',
      message: 'countedScores (3) cannot exceed the roster of 2 (2 tier(s) × 1 pick(s) per tier).',
    });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });

  it('accepts a tiered contest update whose countedScores equals the event\'s tier count times picksPerTier', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      createContestRepo(),
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

    const result = await service.updateContestConfiguration('contest-1', {
      maxEntriesPerSquad: 2,
      picksPerTier: 3,
      countedScores: 6,
    });

    expect(contestConfigurationRepo.update).toHaveBeenCalledWith(
      'config-1',
      expect.objectContaining({ configJson: { picksPerTier: 3, countedScores: 6 } }),
    );
    expect(result.configuration).toMatchObject({ picksPerTier: 3, countedScores: 6 });
  });

  it('returns contest management detail by contest id', async () => {
    const service = new ContestManagementService(
      createContestRepo(),
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

  it('reads only the typed settings from a configuration saved with extra keys, taking the entry cap from its column', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const stored = await contestConfigurationRepo.findByContest('contest-1');
    // A row written before #416 kept the whole request in configJson, a lock time and a
    // stale entry cap included.
    const legacyConfigJson = {
      picksPerTier: 1,
      countedScores: 4,
      rosterSize: 6,
      locksAt: '2026-04-10T12:00:00.000Z',
      maxEntriesPerSquad: 9,
    };
    contestConfigurationRepo.findByContest = jest.fn().mockResolvedValue({
      ...stored,
      configJson: legacyConfigJson,
      maxEntriesPerSquad: 1,
    });
    const service = new ContestManagementService(
      createContestRepo(),
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader(),
    );

    const result = await service.getContest('contest-1');

    expect(result.configuration).toEqual({
      id: 'config-1',
      contestId: 'contest-1',
      picksPerTier: 1,
      countedScores: 4,
      maxEntriesPerSquad: 1,
    });
  });

  it('pool-master-41t echoes the linked event\'s effective tiers read-only on the management detail', async () => {
    const golfTierService = createSportEventTierServiceStub(2, true);
    const service = new ContestManagementService(
      createContestRepo(),
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
    const contestCoreRepo = createContestRepo();
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
        configJson: { picksPerTier: 1, countedScores: 4 },
        maxEntriesPerSquad: 1,
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
      createContestRepo(),
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
          picksPerTier: 2,
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
    expect(createInput.configJson).toEqual({ picksPerTier: 2, countedScores: 8 });
  });

  // #245 — neither a template nor a configuration: the service holds the rule even without the
  // route's refine in front of it.
  it('rejects a create naming neither a template nor a configuration', async () => {
    const contestCoreRepo = createContestRepo();
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
    const contestCoreRepo = createContestRepo();
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
      createContestRepo(),
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
      createContestRepo(),
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
    const contestCoreRepo = createContestRepo();
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
          maxEntriesPerSquad: 3,
          picksPerTier: 1,
          countedScores: 4,
        },
      },
    )).rejects.toMatchObject({
      code: 'SPORT_EVENT_FIELD_NOT_LOADED',
      message: 'Selected sporting event field has not loaded yet.',
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'refuses with SPORT_EVENT_NOT_RELEASED while the event is still a draft',
      event: { status: SportEventStatus.DRAFT },
      code: 'SPORT_EVENT_NOT_RELEASED',
      message: 'Selected sporting event is not released for contest creation yet.',
    },
    {
      name: 'refuses with SPORT_EVENT_ALREADY_STARTED once the event\'s start time has passed',
      event: { startDate: new Date('2026-04-23T12:00:00.000Z') },
      code: 'SPORT_EVENT_ALREADY_STARTED',
      message: 'Selected sporting event has already started, so contests can no longer be created on it.',
    },
    {
      name: 'refuses with SPORT_EVENT_ALREADY_STARTED for an event in progress, whatever its start time',
      event: { status: SportEventStatus.IN_PROGRESS },
      code: 'SPORT_EVENT_ALREADY_STARTED',
      message: 'Selected sporting event has already started, so contests can no longer be created on it.',
    },
  ])('createContest $name, creating nothing', async ({ event, code, message }) => {
    const contestCoreRepo = createContestRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader({ ...event, loadedParticipantCount: 72 }),
    );

    await expect(service.createContest(
      { leagueId: 'league-1' },
      {
        name: 'Unavailable Event Contest',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          maxEntriesPerSquad: 3,
          picksPerTier: 1,
          countedScores: 4,
        },
      },
    )).rejects.toMatchObject({ code, message });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  describe('refusals and legacy rows', () => {
    const EVENT_ID = '11111111-1111-1111-1111-111111111111';
    const CREATE: CreateContestRequest = {
      name: 'Masters Pool',
      sportEventId: EVENT_ID,
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      configuration: { maxEntriesPerSquad: 1, picksPerTier: 1, countedScores: 4 },
    };

    function build(options: {
      reader?: ReturnType<typeof createSportEventReader> | undefined;
      contestRepo?: ContestRepository;
      configurationRepo?: ContestConfigurationRepository;
      templateRepo?: ContestConfigTemplateRepository;
    } = {}) {
      const contestRepo = options.contestRepo ?? createContestRepo();
      const configurationRepo = options.configurationRepo ?? createContestConfigurationRepo();
      const service = new ContestManagementService(
        contestRepo,
        options.templateRepo ?? createContestConfigTemplateRepo(),
        configurationRepo,
        createParticipantScoringRuleRepo(),
        createSportEventTierServiceStub(),
        undefined,
        'reader' in options ? options.reader : createSportEventReader(),
        () => CONTEST_MANAGEMENT_TEST_NOW,
      );
      return { service, contestRepo, configurationRepo };
    }

    it('refuses creating on an event an admin has not released, with SPORT_EVENT_NOT_RELEASED and no contest stored', async () => {
      const { service, contestRepo } = build({ reader: createSportEventReader({ status: SportEventStatus.DRAFT }) });

      await expect(service.createContest({ leagueId: 'league-1' }, CREATE))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_RELEASED' });
      expect(contestRepo.create).not.toHaveBeenCalled();
    });

    it('refuses creating on an event that has already started, with SPORT_EVENT_ALREADY_STARTED', async () => {
      const { service, contestRepo } = build({
        reader: createSportEventReader({ startDate: new Date('2026-04-23T08:00:00.000Z') }),
      });

      await expect(service.createContest({ leagueId: 'league-1' }, CREATE))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED' });
      expect(contestRepo.create).not.toHaveBeenCalled();
    });

    it('refuses creating on an unknown event with 404 SPORT_EVENT_NOT_FOUND', async () => {
      const reader = createSportEventReader();
      reader.findById.mockResolvedValue(null);
      const { service } = build({ reader });

      await expect(service.createContest({ leagueId: 'league-1' }, CREATE))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });
    });

    it('refuses an inactive template as not found', async () => {
      const templateRepo = createContestConfigTemplateRepo();
      const template = await templateRepo.findById('any');
      (templateRepo.findById as jest.Mock).mockResolvedValue({ ...template, active: false });
      const { service, contestRepo } = build({ templateRepo });

      await expect(service.createContest({ leagueId: 'league-1' }, { ...CREATE, templateId: template!.id }))
        .rejects.toThrow('Contest configuration template not found');
      expect(contestRepo.create).not.toHaveBeenCalled();
    });

    it('refuses a template made for another contest format', async () => {
      const templateRepo = createContestConfigTemplateRepo();
      const template = await templateRepo.findById('any');
      (templateRepo.findById as jest.Mock).mockResolvedValue({ ...template, contestFormat: ContestFormat.SURVIVOR });
      const { service } = build({ templateRepo });

      await expect(service.createContest({ leagueId: 'league-1' }, { ...CREATE, templateId: template!.id }))
        .rejects.toThrow('does not match the requested contest type');
    });

    it('answers 404 CONTEST_NOT_FOUND reading a contest that does not exist', async () => {
      const contestRepo = createContestRepo();
      (contestRepo.findById as jest.Mock).mockResolvedValue(null);
      const { service } = build({ contestRepo });

      await expect(service.getContest('missing')).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
    });

    it('refuses a settings change on an open contest with 409 CONTEST_CONFIGURATION_LOCKED and stores nothing', async () => {
      const contestRepo = createContestRepo();
      const contest = await contestRepo.findById('contest-1');
      (contestRepo.findById as jest.Mock).mockResolvedValue({ ...contest, status: ContestStatus.OPEN });
      const { service, configurationRepo } = build({ contestRepo });

      await expect(service.updateContestConfiguration('contest-1', { maxEntriesPerSquad: 2, picksPerTier: 1, countedScores: 3 }))
        .rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
      expect(configurationRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 CONTEST_NOT_FOUND changing settings of a contest with no configuration or no contest row', async () => {
      const configurationRepo = createContestConfigurationRepo();
      (configurationRepo.findByContest as jest.Mock).mockResolvedValueOnce(null);
      await expect(build({ configurationRepo }).service.updateContestConfiguration('contest-1', CREATE.configuration!))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });

      const contestRepo = createContestRepo();
      (contestRepo.findById as jest.Mock).mockResolvedValue(null);
      await expect(build({ contestRepo }).service.updateContestConfiguration('contest-1', CREATE.configuration!))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });
    });

    it('answers 404 opening a draft whose event is gone, and opens without an event check when no reader is wired', async () => {
      const reader = createSportEventReader();
      reader.findById.mockResolvedValue(null);
      await expect(build({ reader }).service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });

      const contestRepo = createContestRepo();
      (contestRepo.transitionStatus as jest.Mock).mockResolvedValue(true);
      await expect(build({ contestRepo, reader: undefined }).service.openContest('league-1', 'contest-1'))
        .resolves.toMatchObject({ id: 'contest-1' });
    });

    it('answers 404 opening a draft with no configuration', async () => {
      const configurationRepo = createContestConfigurationRepo();
      (configurationRepo.findByContest as jest.Mock).mockResolvedValue(null);

      await expect(build({ configurationRepo }).service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
    });

    it('refuses to read a tiered configuration with no typed settings rather than guessing a roster', async () => {
      const configurationRepo = createContestConfigurationRepo();
      const stored = await configurationRepo.findByContest('contest-1');
      (configurationRepo.findByContest as jest.Mock).mockResolvedValue({
        ...stored,
        configJson: undefined,
        rosterSize: 3,
        maxEntriesPerSquad: null,
      });

      await expect(build({ configurationRepo }).service.getContest('contest-1'))
        .rejects.toThrow('missing typed golf contest data');
    });

    it('refuses to read a legacy non-tiered configuration with no typed settings', async () => {
      const configurationRepo = createContestConfigurationRepo();
      const stored = await configurationRepo.findByContest('contest-1');
      (configurationRepo.findByContest as jest.Mock).mockResolvedValue({
        ...stored,
        configJson: undefined,
        selectionType: SelectionType.BUDGET_PICK,
      });

      await expect(build({ configurationRepo }).service.getContest('contest-1'))
        .rejects.toThrow('missing typed golf contest data');
    });
  });
});

