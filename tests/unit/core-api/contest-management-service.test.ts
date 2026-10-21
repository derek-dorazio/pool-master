import { expect } from '@jest/globals';
import {
  ContestFormat,
  ContestStatus,
  type ContestScoringSettings,
  MatchSide,
  MatchStatus,
  type ParticipantContestScoringRule,
  PickEmMode,
  SelectionType,
  Sport,
  SportEventStatus,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import {
  CONTEST_BUDGET_FIELD_OUT_OF_RANGE,
  CONTEST_BRACKET_SINGLE_EVENT,
  CONTEST_BUDGET_UNFILLABLE,
  CONTEST_DRAW_FIELD_OUT_OF_RANGE,
  CONTEST_RULES_SELECTION_TYPE_MISMATCH,
  CONTEST_CONFIGURATION_LOCKED,
  CONTEST_CONFIGURATION_REQUIRED,
  CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH,
  CONTEST_EVENT_ALREADY_STARTED,
  CONTEST_EVENT_HAS_NO_GAMES,
  CONTEST_EVENT_NOT_A_BRACKET,
  CONTEST_EVENT_NOT_PRICED,
  CONTEST_EVENT_SPREAD_MISSING,
  CONTEST_SPREAD_NOT_OFFERED,
  CONTEST_NOT_DRAFT,
  CONTEST_SCORING_DEFINITION_NOT_ALLOWED,
  CONTEST_SCORING_ROUNDS_MISMATCH,
  CONTEST_SCORING_SETTINGS_REQUIRED,
  CONTEST_SQUARES_GAME_INVALID,
  CONTEST_SQUARES_GAME_REQUIRED,
  CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD,
  CONTEST_SQUARES_SINGLE_EVENT,
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
  type ContestCreateSportEventReader,
} from '../../../packages/core-api/src/modules/contest-management/service';
import { cutoffTiming } from '../../../packages/core-api/src/modules/contests/entry-window';
import { createContestSportEventReader } from '../../../packages/core-api/src/modules/contest-management/wiring';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  fakeContestRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { expectDefined } from '../../support/expect-defined';
import { EIGHT_SEEDS, eightTeamBracket, withResults } from '../../support/bracket-fixtures';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

const CONTEST_MANAGEMENT_TEST_NOW = new Date('2026-04-23T12:00:00.000Z');

function createContestRepo(): ContestRepository {
  return fakeContestRepo({
    findById: jest.fn().mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventIds: ['11111111-1111-1111-1111-111111111111'],
      name: 'Contest 1',
      status: ContestStatus.DRAFT,
      contestFormat: ContestFormat.ROSTER,
      selectionType: 'TIERED',
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    }),
    create: mockFn<ContestRepository['create']>(async (contest) => ({
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
      maxEntriesPerSquad: 1,
      selectionType: SelectionType.TIERED,
      picksPerTier: 1,
      countedScores: 4,
    },
    maxEntriesPerSquad: 1,
    rosterSize: 6,
    pickCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    findByContest: jest.fn().mockImplementation(async () => ({ ...state })),
    findByTemplateEventSeries: jest.fn().mockResolvedValue([]),
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
    sportLeagueId: null,
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
      selectionType: SelectionType.TIERED,
      picksPerTier: 1,
      countedScores: 4,
    },
    eventSeriesNames: [],
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
        sortOrder: 1,
        scoring: { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: mockFn<ParticipantContestScoringRuleRepository['create']>(async (rule) => ({
      id: `rule-${rule.sortOrder}`,
      ...rule,
      scoring: { success: true, data: rule.scoring },
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

const PGA_TOUR_LEAGUE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LPGA_TOUR_LEAGUE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createSportEventReader(overrides?: Partial<{
  status: SportEventStatus;
  startDate: Date;
  sport: Sport;
  sportLeagueId: string;
  tournamentFormat: TournamentFormat;
  participantCount: number | null;
  loadedParticipantCount: number;
  rounds: number | null;
  salaryCap: number | null;
  activeFieldPrices: number[];
  gameCount: number;
  undecidedGameCount: number;
  gamesWithoutSpreadCount: number;
  bracketProblem: string | null;
  squaresFromRound: number | null;
}>): {
  findById: jest.Mock;
  findActiveFieldPrices: jest.Mock;
  countGames: jest.Mock;
  countUndecidedGames: jest.Mock;
  countGamesWithoutSpread: jest.Mock;
  findBracketProblem: jest.Mock;
  findCutoffTiming: jest.Mock;
  findGame: jest.Mock;
} {
  return {
    findActiveFieldPrices: jest.fn().mockResolvedValue(overrides?.activeFieldPrices ?? []),
    countGames: jest.fn().mockResolvedValue(overrides?.gameCount ?? 0),
    countUndecidedGames: jest.fn().mockResolvedValue(overrides?.undecidedGameCount ?? 0),
    countGamesWithoutSpread: jest.fn().mockResolvedValue(overrides?.gamesWithoutSpreadCount ?? 0),
    findBracketProblem: jest.fn().mockResolvedValue(overrides?.bracketProblem ?? null),
    // The event's own timing for an ordinary contest; a later round's start would read its games, of which this event has none.
    findCutoffTiming: mockFn<ContestCreateSportEventReader['findCutoffTiming']>(async (sportEvent, cutoff) => cutoffTiming(cutoff, sportEvent, [])),
    findGame: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: overrides?.status ?? SportEventStatus.SCHEDULED,
      startDate: overrides?.startDate ?? new Date('2026-05-14T12:00:00.000Z'),
      sport: overrides?.sport ?? Sport.GOLF,
      sportLeagueId: overrides?.sportLeagueId ?? PGA_TOUR_LEAGUE_ID,
      tournamentFormat:
        overrides?.tournamentFormat ?? TournamentFormat.STROKE_PLAY_TOURNAMENT,
      participantCount: overrides?.participantCount ?? 72,
      loadedParticipantCount: overrides?.loadedParticipantCount ?? 72,
      rounds: overrides?.rounds === undefined ? 4 : overrides.rounds,
      salaryCap: overrides?.salaryCap ?? null,
      squaresFromRound: overrides?.squaresFromRound ?? null,
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          maxEntriesPerSquad: 3,
          selectionType: SelectionType.TIERED,
          picksPerTier: 1,
          countedScores: 4,
        },
      },
    );

    expect(contestCoreRepo.create).toHaveBeenCalledWith({
      leagueId: 'league-1',
      sportEventIds: ['11111111-1111-1111-1111-111111111111'],
      name: 'Masters Pick 6',
      selectionType: 'TIERED',
      contestFormat: ContestFormat.ROSTER,
      status: ContestStatus.DRAFT,
    });
    expect(result).toBe('contest-1');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: undefined,
        selectionType: 'TIERED',
        // configJson holds only GolfContestConfig's own fields; the entry cap has its column (#416).
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
        maxEntriesPerSquad: 3,
      }),
    );
    // The rule's settings are its definition's typed settings: golf's to-par total takes none.
    expect(participantContestScoringRuleRepo.create).toHaveBeenCalledWith({
      contestConfigurationId: 'config-1',
      sortOrder: 1,
      scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
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
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          configuration: {
            maxEntriesPerSquad: 3,
            selectionType: SelectionType.TIERED,
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
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          configuration: {
            maxEntriesPerSquad: 3,
            selectionType: SelectionType.TIERED,
            picksPerTier: 2,
            countedScores: 4,
          },
        },
      ),
    ).resolves.toBe('contest-1');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ configJson: { selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 4 } }),
    );
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ rosterSize: expect.anything() }),
    );
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ pickCount: expect.anything() }),
    );
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
      service.updateContestConfiguration('contest-1', { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 5 }),
    ).rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });

  describe('a sport league\'s own template (#624)', () => {
    async function createFromLeagueTemplate(templateLeagueId: string | null, eventLeagueId: string) {
      const contestCoreRepo = createContestRepo();
      const templateRepo = createContestConfigTemplateRepo();
      const template = await templateRepo.findById('11111111-1111-4111-8111-111111111111');
      if (!template) throw new Error('The template fake holds one template');
      jest.mocked(templateRepo.findById).mockResolvedValue({ ...template, sportLeagueId: templateLeagueId });
      const service = new ContestManagementService(
        contestCoreRepo,
        templateRepo,
        createContestConfigurationRepo(),
        createParticipantScoringRuleRepo(),
        createSportEventTierServiceStub(),
        undefined,
        createSportEventReader({ sportLeagueId: eventLeagueId }),
      );
      const created = service.createContest({ leagueId: 'league-1' }, {
        name: 'Major Pick 6',
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateId: '11111111-1111-4111-8111-111111111111',
      });
      return { created, contestCoreRepo };
    }

    it('refuses with 422 CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH and creates nothing when the template is another league\'s', async () => {
      const { created, contestCoreRepo } = await createFromLeagueTemplate(LPGA_TOUR_LEAGUE_ID, PGA_TOUR_LEAGUE_ID);

      await expect(created).rejects.toMatchObject({ code: CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH, statusCode: 422 });
      expect(contestCoreRepo.create).not.toHaveBeenCalled();
    });

    it('creates the contest when the template is the event\'s own league\'s', async () => {
      const { created, contestCoreRepo } = await createFromLeagueTemplate(LPGA_TOUR_LEAGUE_ID, LPGA_TOUR_LEAGUE_ID);

      await expect(created).resolves.toBe('contest-1');
      expect(contestCoreRepo.create).toHaveBeenCalledTimes(1);
    });

    it('creates the contest from a sport-wide template (no sport league) for any league\'s event', async () => {
      const { created, contestCoreRepo } = await createFromLeagueTemplate(null, LPGA_TOUR_LEAGUE_ID);

      await expect(created).resolves.toBe('contest-1');
      expect(contestCoreRepo.create).toHaveBeenCalledTimes(1);
    });
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        name: 'Contest 1',
        status: options?.status ?? ContestStatus.DRAFT,
        contestFormat: ContestFormat.ROSTER,
        selectionType: 'TIERED',
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
      selectionType: SelectionType.TIERED,
      picksPerTier: 2,
      countedScores: 5,
    });

    // configJson stores only GolfContestConfig's two fields; maxEntriesPerSquad has its own
    // column, so a JSON copy could only drift from it (#416).
    const storedConfigJson = {
      countedScores: 5,
      selectionType: SelectionType.TIERED,
      picksPerTier: 2,
    };
    // #245 — an update never rewrites selectionType: it is fixed at create, and the
    // mapSelectionType echo that re-derived it on every save is gone.
    expect(contestConfigurationRepo.update).toHaveBeenCalledWith('config-1', {
      configJson: storedConfigJson,
      maxEntriesPerSquad: 2,
    });
    expect(participantContestScoringRuleRepo.delete).toHaveBeenCalledWith(
      'rule-old',
    );
    expect(result.configuration).toMatchObject({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 5 });
    // pool-master-41t — the refreshed detail carries the read-only
    // effectiveTiers echo (plans/124 §5.3).
    expect(result.sportEvents[0]?.effectiveTiers).toEqual([]);
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
        selectionType: SelectionType.TIERED,
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
      selectionType: SelectionType.TIERED,
      picksPerTier: 3,
      countedScores: 6,
    });

    expect(contestConfigurationRepo.update).toHaveBeenCalledWith(
      'config-1',
      expect.objectContaining({ configJson: { selectionType: SelectionType.TIERED, picksPerTier: 3, countedScores: 6 } }),
    );
    expect(result.configuration).toMatchObject({ selectionType: SelectionType.TIERED, picksPerTier: 3, countedScores: 6 });
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
    expect(result.configuration).toMatchObject({ selectionType: SelectionType.TIERED, countedScores: 4 });
    // pool-master-41t — the detail response always carries the read-only
    // effectiveTiers echo (plans/124 §5.3); empty here because this event
    // has no tiers defined.
    expect(result.sportEvents[0]?.effectiveTiers).toEqual([]);
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
    expect(result.sportEvents[0]?.effectiveTiers).toEqual([
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
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
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateId: '11111111-1111-4111-8111-111111111111',
        configuration: {
          selectionType: SelectionType.TIERED,
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
    expect(createInput.configJson).toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 8 });
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
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
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
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
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
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          maxEntriesPerSquad: 3,
          selectionType: SelectionType.TIERED,
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
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          maxEntriesPerSquad: 3,
          selectionType: SelectionType.TIERED,
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
      sportEventIds: [EVENT_ID],
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
    };

    function build(options: {
      reader?: ReturnType<typeof createSportEventReader>;
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
        options.reader ?? createSportEventReader(),
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

      await expect(service.createContest({ leagueId: 'league-1' }, { ...CREATE, templateId: expectDefined(template).id }))
        .rejects.toThrow('Contest configuration template not found');
      expect(contestRepo.create).not.toHaveBeenCalled();
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

      await expect(service.updateContestConfiguration('contest-1', { maxEntriesPerSquad: 2, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 3 }))
        .rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
      expect(configurationRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 CONTEST_NOT_FOUND changing settings of a contest with no configuration or no contest row', async () => {
      const configurationRepo = createContestConfigurationRepo();
      (configurationRepo.findByContest as jest.Mock).mockResolvedValueOnce(null);
      await expect(build({ configurationRepo }).service.updateContestConfiguration('contest-1', expectDefined(CREATE.configuration)))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });

      const contestRepo = createContestRepo();
      (contestRepo.findById as jest.Mock).mockResolvedValue(null);
      await expect(build({ contestRepo }).service.updateContestConfiguration('contest-1', expectDefined(CREATE.configuration)))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });
    });

    it('refuses a settings change on a contest with no sport event, with 404 SPORT_EVENT_NOT_FOUND and nothing stored', async () => {
      const contestRepo = createContestRepo();
      const contest = await contestRepo.findById('contest-1');
      (contestRepo.findById as jest.Mock).mockResolvedValue({ ...contest, sportEventIds: [] });
      const { service, configurationRepo } = build({ contestRepo });

      await expect(service.updateContestConfiguration('contest-1', expectDefined(CREATE.configuration)))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });
      expect(configurationRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 opening a draft whose event is gone', async () => {
      const reader = createSportEventReader();
      reader.findById.mockResolvedValue(null);
      await expect(build({ reader }).service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404 });
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


describe('ContestManagementService budget rules (#93)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const budgetRequest = (configuration: { rosterSize: number; countedScores: number }): CreateContestRequest => ({
    name: 'Masters Budget',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'ROSTER',
    selectionType: SelectionType.BUDGET_PICK,
    configuration: { selectionType: SelectionType.BUDGET_PICK, maxEntriesPerSquad: 1, ...configuration },
  });

  function budgetService(reader: ReturnType<typeof createSportEventReader>) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      reader,
    );
    return { contestCoreRepo, contestConfigurationRepo, service };
  }

  it('creates a budget contest with the event\'s salary cap stored beside the commissioner\'s rules', async () => {
    const { contestConfigurationRepo, service } = budgetService(createSportEventReader({
      salaryCap: 50_000,
      activeFieldPrices: [12_000, 9_400, 7_700, 6_400, 6_000, 6_000, 6_000],
    }));

    await service.createContest({ leagueId: 'league-1' }, budgetRequest({ rosterSize: 6, countedScores: 4 }));

    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.BUDGET_PICK,
      configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, salaryCap: 50_000, countedScores: 4 },
      maxEntriesPerSquad: 1,
    }));
  });

  it('refuses budget rules on an event whose field was never priced with 409 CONTEST_EVENT_NOT_PRICED, writing nothing', async () => {
    const { contestCoreRepo, service } = budgetService(createSportEventReader({ salaryCap: null }));

    await expect(service.createContest({ leagueId: 'league-1' }, budgetRequest({ rosterSize: 6, countedScores: 6 })))
      .rejects.toMatchObject({ code: CONTEST_EVENT_NOT_PRICED, statusCode: 409 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['the cheapest roster costs more than the cap', [40, 40, 30, 20], 3],
    ['the field has fewer priced golfers than the roster holds', [10, 10], 3],
  ])('refuses a budget roster nobody could afford when %s, with 409 CONTEST_BUDGET_UNFILLABLE', async (_case, prices, rosterSize) => {
    const { contestCoreRepo, service } = budgetService(createSportEventReader({ salaryCap: 80, activeFieldPrices: prices }));

    await expect(service.createContest({ leagueId: 'league-1' }, budgetRequest({ rosterSize, countedScores: 1 })))
      .rejects.toMatchObject({ code: CONTEST_BUDGET_UNFILLABLE, statusCode: 409 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('accepts a roster whose cheapest golfers fit the cap to the cent', async () => {
    const { contestConfigurationRepo, service } = budgetService(createSportEventReader({
      salaryCap: 100,
      activeFieldPrices: [33.34, 33.33, 33.33],
    }));

    await service.createContest({ leagueId: 'league-1' }, budgetRequest({ rosterSize: 3, countedScores: 3 }));

    expect(contestConfigurationRepo.create).toHaveBeenCalled();
  });

  it('refuses more counted scores than the roster holds with 422 CONTEST_BUDGET_FIELD_OUT_OF_RANGE', async () => {
    const { contestCoreRepo, service } = budgetService(createSportEventReader({ salaryCap: 50_000, activeFieldPrices: [1, 1, 1, 1, 1, 1] }));

    await expect(service.createContest({ leagueId: 'league-1' }, budgetRequest({ rosterSize: 4, countedScores: 5 })))
      .rejects.toMatchObject({ code: CONTEST_BUDGET_FIELD_OUT_OF_RANGE, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses rules of another selection type than the contest\'s, on create and on update', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = budgetService(createSportEventReader({
      salaryCap: 50_000,
      activeFieldPrices: [1, 1, 1, 1, 1, 1],
    }));

    await expect(service.createContest({ leagueId: 'league-1' }, { ...budgetRequest({ rosterSize: 6, countedScores: 6 }), selectionType: SelectionType.TIERED }))
      .rejects.toMatchObject({ code: CONTEST_RULES_SELECTION_TYPE_MISMATCH, statusCode: 422 });
    // The stored contest is tiered: budget rules cannot replace its rules.
    await expect(service.updateContestConfiguration('contest-1', {
      selectionType: SelectionType.BUDGET_PICK,
      rosterSize: 6,
      countedScores: 6,
    })).rejects.toMatchObject({ code: CONTEST_RULES_SELECTION_TYPE_MISMATCH, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });
  it('refuses to open a budget draft whose event field, after withdrawals, can no longer fill the roster under the cap, saving nothing', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = budgetService(createSportEventReader({
      salaryCap: 100,
      activeFieldPrices: [60, 50],
    }));
    (contestCoreRepo.findById as jest.Mock).mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventIds: ['11111111-1111-1111-1111-111111111111'],
      name: 'Masters Budget',
      status: ContestStatus.DRAFT,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.BUDGET_PICK,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    });
    (contestConfigurationRepo.findByContest as jest.Mock).mockResolvedValue({
      id: 'config-1',
      contestId: 'contest-1',
      selectionType: SelectionType.BUDGET_PICK,
      configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, countedScores: 2, salaryCap: 100 },
      maxEntriesPerSquad: 1,
      createdAt: new Date('2026-04-07T12:00:01.000Z'),
      updatedAt: new Date('2026-04-07T12:00:01.000Z'),
    });

    await expect(service.openContest('league-1', 'contest-1'))
      .rejects.toMatchObject({ code: CONTEST_BUDGET_UNFILLABLE, statusCode: 409 });
    expect(contestCoreRepo.transitionStatus).not.toHaveBeenCalled();
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });
});

describe('ContestManagementService random-draw rules (#601)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const drawRequest = (configuration: { picksPerEntry: number; countedScores: number }): CreateContestRequest => ({
    name: 'Masters Sweepstake',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'ROSTER',
    selectionType: SelectionType.RANDOM_DRAW,
    configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, ...configuration },
  });

  function drawService() {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader({ salaryCap: null }),
    );
    return { contestCoreRepo, contestConfigurationRepo, service };
  }

  it('creates a golf random-draw contest storing how many golfers the draw deals each entry, with no prices or tiers needed', async () => {
    const { contestConfigurationRepo, service } = drawService();

    await service.createContest({ leagueId: 'league-1' }, drawRequest({ picksPerEntry: 3, countedScores: 2 }));

    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 3, countedScores: 2 },
      maxEntriesPerSquad: 1,
    }));
  });

  it('refuses more counted scores than the draw deals an entry with 422 CONTEST_DRAW_FIELD_OUT_OF_RANGE, writing nothing', async () => {
    const { contestCoreRepo, service } = drawService();

    await expect(service.createContest({ leagueId: 'league-1' }, drawRequest({ picksPerEntry: 2, countedScores: 3 })))
      .rejects.toMatchObject({ code: CONTEST_DRAW_FIELD_OUT_OF_RANGE, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});

describe('ContestManagementService finish-position scoring (#622)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const WIN_PLACE_SHOW: ContestScoringSettings = {
    participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
    config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 },
  };
  const drawRules = { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, picksPerEntry: 1, countedScores: 1 } as const;
  // The draft the stub configuration repository holds is a tiered one.
  const tieredRules = { selectionType: SelectionType.TIERED, maxEntriesPerSquad: 1, picksPerTier: 1, countedScores: 3 } as const;
  const raceRequest = (overrides: Partial<CreateContestRequest> = {}): CreateContestRequest => ({
    name: 'Derby Sweepstake',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'ROSTER',
    selectionType: SelectionType.RANDOM_DRAW,
    configuration: drawRules,
    ...overrides,
  });

  function raceService(storedScoring: ContestScoringSettings = WIN_PLACE_SHOW) {
    const contestCoreRepo = createContestRepo();
    const templateRepo = createContestConfigTemplateRepo();
    jest.mocked(templateRepo.findById).mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      sport: Sport.HORSE_RACING,
      sportLeagueId: null,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.RANDOM_DRAW,
      templateKey: 'horse-racing-random-draw-win-place-show',
      name: 'Random draw, Win/Place/Show',
      description: 'Horse racing random draw',
      sortOrder: 3,
      isDefault: false,
      active: true,
      configJson: { ...drawRules, scoring: WIN_PLACE_SHOW },
      eventSeriesNames: [],
      schemaVersion: 1,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    });
    const scoringRuleRepo = createParticipantScoringRuleRepo();
    jest.mocked(scoringRuleRepo.findByContestConfiguration).mockResolvedValue([{
      id: 'rule-old',
      contestConfigurationId: 'config-1',
      sortOrder: 1,
      scoring: { success: true, data: storedScoring },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    const service = new ContestManagementService(
      contestCoreRepo,
      templateRepo,
      createContestConfigurationRepo(),
      scoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader({ sport: Sport.HORSE_RACING, tournamentFormat: TournamentFormat.RACE }),
    );
    return { contestCoreRepo, scoringRuleRepo, service };
  }

  it('creates a horse racing contest scored by the points table it was sent', async () => {
    const { scoringRuleRepo, service } = raceService();
    const scoring: ContestScoringSettings = {
      participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
      config: { pointsTable: [10, 6, 3, 1], didNotFinishPoints: 0 },
    };

    await service.createContest({ leagueId: 'league-1' }, raceRequest({ configuration: { ...drawRules, scoring } }));

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring }));
  });

  it('creates a horse racing contest from a template scored by the template\'s points table when no scoring is sent', async () => {
    const { scoringRuleRepo, service } = raceService();

    await service.createContest({ leagueId: 'league-1' }, raceRequest({
      templateId: '99999999-9999-4999-8999-999999999999',
      configuration: { ...drawRules, countedScores: 1 },
    }));

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring: WIN_PLACE_SHOW }));
  });

  it('refuses a horse racing contest with neither scoring nor a template with 422 CONTEST_SCORING_SETTINGS_REQUIRED, writing nothing', async () => {
    const { contestCoreRepo, service } = raceService();

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest()))
      .rejects.toMatchObject({ code: CONTEST_SCORING_SETTINGS_REQUIRED, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses golf\'s to-par scoring on a horse racing contest with 422 CONTEST_SCORING_DEFINITION_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = raceService();

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({
      configuration: { ...drawRules, scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
    }))).rejects.toMatchObject({ code: CONTEST_SCORING_DEFINITION_NOT_ALLOWED, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  function basketballService(rounds: number, bracketProblem: string | null = null) {
    const contestCoreRepo = createContestRepo();
    const scoringRuleRepo = createParticipantScoringRuleRepo();
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      createContestConfigurationRepo(),
      scoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createSportEventReader({ sport: Sport.BASKETBALL, tournamentFormat: TournamentFormat.MATCHES, rounds, bracketProblem }),
    );
    return { contestCoreRepo, scoringRuleRepo, service };
  }

  const knockoutScoring = (roundValues: number[]): ContestScoringSettings => ({
    participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
    config: { roundValues, upsetBonus: { rule: 'NONE' } },
  });

  it('refuses a basketball contest with neither knockout round values nor a template with 422 CONTEST_SCORING_SETTINGS_REQUIRED, writing nothing', async () => {
    const { contestCoreRepo, service } = basketballService(4);

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({ name: 'Bracket Pool' })))
      .rejects.toMatchObject({ code: CONTEST_SCORING_SETTINGS_REQUIRED, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses knockout round values that do not give one value per round of the event with 422 CONTEST_SCORING_ROUNDS_MISMATCH, writing nothing', async () => {
    const { contestCoreRepo, service } = basketballService(4);

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({
      name: 'Bracket Pool',
      configuration: { ...drawRules, scoring: knockoutScoring([1, 2, 4, 8, 16, 32]) },
    }))).rejects.toMatchObject({ code: CONTEST_SCORING_ROUNDS_MISMATCH, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  // #715: a regular-season week's games form no bracket, so there are no rounds to score a team by.
  it('refuses knockout round values on an event whose games form no bracket (a regular-season week) with 422 CONTEST_EVENT_NOT_A_BRACKET, writing nothing', async () => {
    const { contestCoreRepo, service } = basketballService(1, 'its last round has 16 games, not one final');

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({
      name: 'Week Pool',
      configuration: { ...drawRules, scoring: knockoutScoring([1]) },
    }))).rejects.toMatchObject({ code: CONTEST_EVENT_NOT_A_BRACKET, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('creates a basketball contest scored by the knockout round values sent, one per round of the event', async () => {
    const { scoringRuleRepo, service } = basketballService(4);
    const scoring = knockoutScoring([1, 2, 4, 8]);

    await service.createContest({ leagueId: 'league-1' }, raceRequest({ name: 'Bracket Pool', configuration: { ...drawRules, scoring } }));

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring }));
  });

  it('keeps a draft\'s points table when a rules update sends no scoring', async () => {
    const kept: ContestScoringSettings = {
      participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
      config: { pointsTable: [7, 2], didNotFinishPoints: 0 },
    };
    const { scoringRuleRepo, service } = raceService(kept);

    await service.updateContestConfiguration('contest-1', tieredRules);

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring: kept }));
  });

  it('replaces a draft\'s points table with the one a rules update sends', async () => {
    const { scoringRuleRepo, service } = raceService();
    const scoring: ContestScoringSettings = {
      participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
      config: { pointsTable: [3, 2, 1], didNotFinishPoints: 0 },
    };

    await service.updateContestConfiguration('contest-1', { ...tieredRules, scoring });

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring }));
  });
});

// #713: a contest covers one or more events of one sport league, kept in start-date order.
describe('ContestManagementService — a contest of several events', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const MASTERS = '22222222-2222-4222-8222-222222222222';
  const PGA = '33333333-3333-4333-8333-333333333333';
  const US_OPEN = '44444444-4444-4444-8444-444444444444';
  const LPGA_MAJOR = '55555555-5555-4555-8555-555555555555';

  interface ReaderEvent {
    status: SportEventStatus;
    sportLeagueId: string;
    salaryCap: number | null;
    eventYear: number;
  }

  /** A reader over several events, each the default eligible PGA Tour event unless overridden. */
  function multiEventReader(events: Array<{ id: string; startDate: string } & Partial<ReaderEvent>>) {
    const byId = new Map(events.map((event) => [event.id, {
      status: SportEventStatus.SCHEDULED,
      sport: Sport.GOLF,
      sportLeagueId: PGA_TOUR_LEAGUE_ID,
      tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
      participantCount: 72,
      loadedParticipantCount: 72,
      rounds: 4,
      salaryCap: null,
      squaresFromRound: null,
      eventYear: 2026,
      ...event,
      startDate: new Date(event.startDate),
    }]));
    return {
      findById: jest.fn().mockImplementation(async (id: string) => byId.get(id) ?? null),
      findActiveFieldPrices: jest.fn().mockResolvedValue([10, 10, 10]),
      countGames: jest.fn().mockResolvedValue(0),
      countUndecidedGames: jest.fn().mockResolvedValue(0),
      countGamesWithoutSpread: jest.fn().mockResolvedValue(0),
      findBracketProblem: jest.fn().mockResolvedValue(null),
      findCutoffTiming: mockFn<ContestCreateSportEventReader['findCutoffTiming']>(async (sportEvent, cutoff) => cutoffTiming(cutoff, sportEvent, [])),
      findGame: jest.fn().mockResolvedValue(null),
    };
  }

  const READER_EVENTS = [
    { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z' },
    { id: PGA, startDate: '2026-05-14T12:00:00.000Z' },
    { id: US_OPEN, startDate: '2026-06-18T12:00:00.000Z' },
    { id: LPGA_MAJOR, startDate: '2026-06-25T12:00:00.000Z', sportLeagueId: LPGA_TOUR_LEAGUE_ID },
  ];

  function build(options: {
    reader?: ReturnType<typeof multiEventReader>;
    contest?: Record<string, unknown>;
    storedConfigJson?: { selectionType: typeof SelectionType.BUDGET_PICK; rosterSize: number; salaryCap: number; countedScores: number };
  } = {}) {
    const contestRepo = createContestRepo();
    if (options.contest) {
      (contestRepo.findById as jest.Mock).mockResolvedValue({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: [MASTERS],
        name: 'Majors Pool',
        status: ContestStatus.DRAFT,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
        ...options.contest,
      });
    }
    const configurationRepo = createContestConfigurationRepo();
    if (options.storedConfigJson) {
      (configurationRepo.findByContest as jest.Mock).mockResolvedValue({
        id: 'config-1',
        contestId: 'contest-1',
        selectionType: options.storedConfigJson.selectionType,
        configJson: options.storedConfigJson,
        maxEntriesPerSquad: 1,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      });
    }
    const service = new ContestManagementService(
      contestRepo,
      createContestConfigTemplateRepo(),
      configurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      options.reader ?? multiEventReader(READER_EVENTS),
      () => CONTEST_MANAGEMENT_TEST_NOW,
    );
    jest.mocked(configurationRepo.findByTemplateEventSeries).mockResolvedValue([
      { id: 'config-1', contestId: 'contest-1', selectionType: SelectionType.TIERED, configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, maxEntriesPerSquad: 1, createdAt: new Date('2026-04-07T12:00:00.000Z'), updatedAt: new Date('2026-04-07T12:00:00.000Z') },
    ]);
    return { service, contestRepo, configurationRepo };
  }

  const tiered = (sportEventIds: string[]): CreateContestRequest => ({
    name: 'Majors Pool',
    sportEventIds,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
  });

  it('creates a contest on several events of one sport league, storing them in start-date order whatever order they were sent in', async () => {
    const { service, contestRepo } = build();

    await service.createContest({ leagueId: 'league-1' }, tiered([US_OPEN, MASTERS, PGA]));

    expect(contestRepo.create).toHaveBeenCalledWith(expect.objectContaining({ sportEventIds: [MASTERS, PGA, US_OPEN] }));
  });

  it('refuses a contest mixing two sport leagues\' events with CONTEST_EVENTS_LEAGUE_MISMATCH, creating nothing', async () => {
    const { service, contestRepo } = build();

    await expect(service.createContest({ leagueId: 'league-1' }, tiered([MASTERS, LPGA_MAJOR])))
      .rejects.toMatchObject({ code: 'CONTEST_EVENTS_LEAGUE_MISMATCH' });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a random-draw contest on more than one event with CONTEST_DRAW_SINGLE_EVENT, creating nothing', async () => {
    const { service, contestRepo } = build();

    await expect(service.createContest({ leagueId: 'league-1' }, {
      name: 'Draw',
      sportEventIds: [MASTERS, PGA],
      contestFormat: 'ROSTER',
      selectionType: SelectionType.RANDOM_DRAW,
      configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, picksPerEntry: 1, countedScores: 1 },
    })).rejects.toMatchObject({ code: 'CONTEST_DRAW_SINGLE_EVENT' });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a budget contest whose events were priced against different salary caps with 409 CONTEST_BUDGET_SALARY_CAP_MISMATCH', async () => {
    const { service, contestRepo } = build({
      reader: multiEventReader([
        { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z', salaryCap: 100 },
        { id: PGA, startDate: '2026-05-14T12:00:00.000Z', salaryCap: 200 },
      ]),
    });

    await expect(service.createContest({ leagueId: 'league-1' }, {
      name: 'Budget Majors',
      sportEventIds: [MASTERS, PGA],
      contestFormat: 'ROSTER',
      selectionType: SelectionType.BUDGET_PICK,
      configuration: { selectionType: SelectionType.BUDGET_PICK, maxEntriesPerSquad: 1, rosterSize: 2, countedScores: 2 },
    })).rejects.toMatchObject({ code: 'CONTEST_BUDGET_SALARY_CAP_MISMATCH', statusCode: 409 });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  it('adds a later event to a live contest, keeping the events in start-date order', async () => {
    const { service, contestRepo } = build({
      reader: multiEventReader([
        { id: MASTERS, startDate: '2026-04-20T12:00:00.000Z', status: SportEventStatus.IN_PROGRESS },
        { id: PGA, startDate: '2026-05-14T12:00:00.000Z' },
      ]),
      contest: { status: ContestStatus.ACTIVE },
    });

    await service.setContestSportEvents('league-1', 'contest-1', [PGA, MASTERS]);

    expect(contestRepo.replaceSportEvents).toHaveBeenCalledWith('contest-1', [MASTERS, PGA]);
  });

  it('refuses removing an event once one of the contest\'s events has started with 409 CONTEST_EVENTS_LOCKED, changing nothing', async () => {
    const { service, contestRepo } = build({
      reader: multiEventReader([
        { id: MASTERS, startDate: '2026-04-20T12:00:00.000Z', status: SportEventStatus.IN_PROGRESS },
        { id: PGA, startDate: '2026-05-14T12:00:00.000Z' },
      ]),
      contest: { status: ContestStatus.ACTIVE, sportEventIds: [MASTERS, PGA] },
    });

    await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS]))
      .rejects.toMatchObject({ code: 'CONTEST_EVENTS_LOCKED', statusCode: 409 });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  it('removes an event from a contest none of whose events has started', async () => {
    const { service, contestRepo } = build({ contest: { status: ContestStatus.OPEN, sportEventIds: [MASTERS, PGA] } });

    await service.setContestSportEvents('league-1', 'contest-1', [PGA]);

    expect(contestRepo.replaceSportEvents).toHaveBeenCalledWith('contest-1', [PGA]);
  });

  it('refuses adding another sport league\'s event with CONTEST_EVENTS_LEAGUE_MISMATCH, changing nothing', async () => {
    const { service, contestRepo } = build({ contest: { status: ContestStatus.OPEN } });

    await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS, LPGA_MAJOR]))
      .rejects.toMatchObject({ code: 'CONTEST_EVENTS_LEAGUE_MISMATCH' });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  it('refuses a second event on a bracket contest with 422 CONTEST_BRACKET_SINGLE_EVENT, changing nothing', async () => {
    const { service, contestRepo } = build({ contest: { contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.BRACKET } });

    await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS, PGA]))
      .rejects.toMatchObject({ code: CONTEST_BRACKET_SINGLE_EVENT, statusCode: 422 });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  it('refuses a second event on a random-draw contest with CONTEST_DRAW_SINGLE_EVENT', async () => {
    const { service, contestRepo } = build({ contest: { selectionType: SelectionType.RANDOM_DRAW } });

    await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS, PGA]))
      .rejects.toMatchObject({ code: 'CONTEST_DRAW_SINGLE_EVENT' });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  it('refuses changing the events of a drawn or COMPLETED contest with 409 CONTEST_EVENTS_LOCKED', async () => {
    for (const contest of [{ drawnAt: new Date('2026-04-10T00:00:00.000Z') }, { status: ContestStatus.COMPLETED }]) {
      const { service, contestRepo } = build({ contest });

      await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS, PGA]))
        .rejects.toMatchObject({ code: 'CONTEST_EVENTS_LOCKED', statusCode: 409 });
      expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
    }
  });

  it('refuses adding an event priced against another salary cap to an open budget contest with 409 CONTEST_BUDGET_SALARY_CAP_MISMATCH', async () => {
    const { service, contestRepo } = build({
      reader: multiEventReader([
        { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z', salaryCap: 100 },
        { id: PGA, startDate: '2026-05-14T12:00:00.000Z', salaryCap: 200 },
      ]),
      contest: { status: ContestStatus.OPEN, selectionType: SelectionType.BUDGET_PICK },
      storedConfigJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 100, countedScores: 2 },
    });

    await expect(service.setContestSportEvents('league-1', 'contest-1', [MASTERS, PGA]))
      .rejects.toMatchObject({ code: 'CONTEST_BUDGET_SALARY_CAP_MISMATCH', statusCode: 409 });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  it('answers 404 CONTEST_NOT_FOUND for another league\'s contest, changing nothing', async () => {
    const { service, contestRepo } = build({ contest: {} });

    await expect(service.setContestSportEvents('league-2', 'contest-1', [MASTERS, PGA]))
      .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
    expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
  });

  describe('a released edition joining the contests made from a template covering its series (#714)', () => {
    const PGA_EDITION = { id: PGA, eventSeriesId: 'series-pga-championship', eventYear: 2026 };
    const startedMasters = multiEventReader([
      { id: MASTERS, startDate: '2026-04-20T12:00:00.000Z', status: SportEventStatus.IN_PROGRESS },
      { id: PGA, startDate: '2026-05-14T12:00:00.000Z' },
    ]);

    it('adds the released major to a live majors pool of its year, after the majors it already has', async () => {
      const { service, contestRepo, configurationRepo } = build({ reader: startedMasters, contest: { status: ContestStatus.ACTIVE } });

      await expect(service.addReleasedEditionToTemplateContests(PGA_EDITION)).resolves.toEqual(['contest-1']);

      expect(configurationRepo.findByTemplateEventSeries).toHaveBeenCalledWith('series-pga-championship');
      expect(contestRepo.replaceSportEvents).toHaveBeenCalledWith('contest-1', [MASTERS, PGA]);
    });

    it('leaves alone a pool that already has the major, a COMPLETED pool, and a pool of another year\'s majors', async () => {
      for (const contest of [
        { status: ContestStatus.ACTIVE, sportEventIds: [MASTERS, PGA] },
        { status: ContestStatus.COMPLETED },
        { status: ContestStatus.ACTIVE },
      ]) {
        const { service, contestRepo } = build({ reader: startedMasters, contest });
        const edition = contest.status === ContestStatus.ACTIVE && !('sportEventIds' in contest)
          ? { ...PGA_EDITION, eventYear: 2027 }
          : PGA_EDITION;

        await expect(service.addReleasedEditionToTemplateContests(edition)).resolves.toEqual([]);

        expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
      }
    });

    it('skips a pool whose rules refuse the major (a random draw keeps one event) without failing the release', async () => {
      const { service, contestRepo } = build({ reader: startedMasters, contest: { selectionType: SelectionType.RANDOM_DRAW } });

      await expect(service.addReleasedEditionToTemplateContests(PGA_EDITION)).resolves.toEqual([]);

      expect(contestRepo.replaceSportEvents).not.toHaveBeenCalled();
    });

    it('does nothing when no template covers the released event\'s series', async () => {
      const { service, contestRepo, configurationRepo } = build({ reader: startedMasters, contest: { status: ContestStatus.ACTIVE } });
      jest.mocked(configurationRepo.findByTemplateEventSeries).mockResolvedValue([]);

      await expect(service.addReleasedEditionToTemplateContests(PGA_EDITION)).resolves.toEqual([]);

      expect(contestRepo.findById).not.toHaveBeenCalled();
    });
  });
});

// #716: a pick'em contest is a PREDICTION contest on an event with games to pick.
describe('ContestManagementService pick\'em rules (#716)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const pickEmRules = { selectionType: SelectionType.PICK_EM, maxEntriesPerSquad: 1, mode: PickEmMode.CONFIDENCE, againstTheSpread: false } as const;
  const knockoutScoring: ContestScoringSettings = {
    participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
    config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } },
  };
  const pickEmRequest = (overrides: Partial<CreateContestRequest> = {}): CreateContestRequest => ({
    name: 'Week 1 Confidence',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'PREDICTION',
    selectionType: SelectionType.PICK_EM,
    configuration: { ...pickEmRules, scoring: knockoutScoring },
    ...overrides,
  });

  function pickEmService(options: {
    gameCount: number;
    undecidedGameCount?: number;
    gamesWithoutSpreadCount?: number;
    sport?: Sport;
    tournamentFormat?: TournamentFormat;
    rounds?: number;
  }) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const scoringRuleRepo = createParticipantScoringRuleRepo();
    const reader = createSportEventReader({
      sport: options.sport ?? Sport.AMERICAN_FOOTBALL,
      tournamentFormat: options.tournamentFormat ?? TournamentFormat.MATCHES,
      rounds: options.rounds ?? 4,
      gameCount: options.gameCount,
      undecidedGameCount: options.undecidedGameCount,
      gamesWithoutSpreadCount: options.gamesWithoutSpreadCount,
    });
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      scoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      reader,
    );
    return { contestCoreRepo, contestConfigurationRepo, reader, scoringRuleRepo, service };
  }

  // A pick'em pool scores by its mode (#717), so the commissioner sets no scoring table for it.
  it('creates a pick\'em contest sent no scoring, storing a rule of one point a round that its scoring never reads', async () => {
    const { contestCoreRepo, scoringRuleRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules }));

    expect(contestCoreRepo.create).toHaveBeenCalled();
    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1], upsetBonus: { rule: 'NONE' } } },
    }));
  });

  it('refuses a pick\'em contest sent a scoring definition its sport does not offer with 422 CONTEST_SCORING_DEFINITION_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      configuration: { ...pickEmRules, scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
    }))).rejects.toMatchObject({ code: 'CONTEST_SCORING_DEFINITION_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('creates a pick\'em contest whose round table does not match the week\'s rounds, since a pick\'em contest never scores by round', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3, rounds: 1 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest());

    expect(contestCoreRepo.create).toHaveBeenCalled();
  });

  it('creates a PREDICTION pick\'em contest on an event with games, storing only its selection type and mode', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.PICK_EM,
    }));
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.PICK_EM,
      configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false },
    }));
  });

  it('refuses a pick\'em contest on an event with no games with 422 CONTEST_EVENT_HAS_NO_GAMES, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 0 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest()))
      .rejects.toMatchObject({ code: CONTEST_EVENT_HAS_NO_GAMES, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a pick\'em contest on an event with a game whose team is still undecided with 422 CONTEST_EVENT_GAME_UNDECIDED, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3, undecidedGameCount: 1 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest()))
      .rejects.toMatchObject({ code: 'CONTEST_EVENT_GAME_UNDECIDED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  // #720: picks against the spread need every game's spread before the week joins the contest.
  it('creates a pick\'em contest against the spread on a released week whose games all have a spread, storing the option', async () => {
    const { contestConfigurationRepo, reader, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: { ...pickEmRules, againstTheSpread: true } }));

    expect(reader.countGamesWithoutSpread).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: true },
    }));
  });

  it('refuses a pick\'em contest against the spread on a released week with a game lacking a spread with 422 CONTEST_EVENT_SPREAD_MISSING, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3, gamesWithoutSpreadCount: 1 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: { ...pickEmRules, againstTheSpread: true } })))
      .rejects.toMatchObject({ code: CONTEST_EVENT_SPREAD_MISSING, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  // #792: soccer's pick'em takes draw picks but has no spread, so a pool against it is refused.
  it('refuses a soccer pick\'em contest against the spread with 422 CONTEST_SPREAD_NOT_OFFERED, never reading spreads or writing anything', async () => {
    const { contestCoreRepo, reader, service } = pickEmService({ gameCount: 3, sport: Sport.SOCCER });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: { ...pickEmRules, againstTheSpread: true } })))
      .rejects.toMatchObject({ code: CONTEST_SPREAD_NOT_OFFERED, statusCode: 422 });
    expect(reader.countGamesWithoutSpread).not.toHaveBeenCalled();
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('creates a straight-up soccer pick\'em contest, since only the spread is refused', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3, sport: Sport.SOCCER });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules }));

    expect(contestCoreRepo.create).toHaveBeenCalled();
  });

  it('creates a straight-up pick\'em contest on a week with no spreads, never reading them', async () => {
    const { contestCoreRepo, reader, service } = pickEmService({ gameCount: 3, gamesWithoutSpreadCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules }));

    expect(reader.countGamesWithoutSpread).not.toHaveBeenCalled();
    expect(contestCoreRepo.create).toHaveBeenCalled();
  });

  it('refuses PICK_EM sent as a ROSTER contest with 422 CONTEST_FORMAT_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ contestFormat: 'ROSTER' })))
      .rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a roster selection type sent as a PREDICTION contest with 422 CONTEST_FORMAT_NOT_ALLOWED', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      selectionType: SelectionType.RANDOM_DRAW,
      configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, picksPerEntry: 1, countedScores: 1, scoring: knockoutScoring },
    }))).rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a PREDICTION contest on a stroke-play golf event with 422 CONTEST_FORMAT_NOT_ALLOWED', async () => {
    const { contestCoreRepo, service } = pickEmService({
      gameCount: 3, sport: Sport.GOLF, tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
    });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules })))
      .rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
  it('creates a PREDICTION survivor contest on a week with games, storing its selection type and, left out, that teams can be picked again once all are used', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      name: 'Office Survivor',
      selectionType: SelectionType.SURVIVOR,
      configuration: { selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: 1 },
    }));

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.SURVIVOR,
    }));
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.SURVIVOR,
      configJson: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: true },
    }));
  });

  it('stores a survivor contest whose teams can never be picked again as reuseTeamsOnceAllUsed false', async () => {
    const { contestConfigurationRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      name: 'Office Survivor',
      selectionType: SelectionType.SURVIVOR,
      configuration: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false, maxEntriesPerSquad: 1 },
    }));

    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false },
    }));
  });

  it('refuses a survivor contest on a week with no games with 422 CONTEST_EVENT_HAS_NO_GAMES, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 0 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      selectionType: SelectionType.SURVIVOR,
      configuration: { selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: 1 },
    }))).rejects.toMatchObject({ code: CONTEST_EVENT_HAS_NO_GAMES, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});

// #721: a bracket contest is a PREDICTION contest on one knockout event whose every game can be picked.
describe('ContestManagementService bracket rules (#721)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const EVENT_ID = '11111111-1111-1111-1111-111111111111';
  const bracketRequest = (overrides: Partial<CreateContestRequest> = {}): CreateContestRequest => ({
    name: 'March bracket',
    sportEventIds: [EVENT_ID],
    contestFormat: 'PREDICTION',
    selectionType: SelectionType.BRACKET,
    configuration: {
      selectionType: SelectionType.BRACKET,
      startsAtRound: 1,
      maxEntriesPerSquad: 2,
      scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } } },
    },
    ...overrides,
  });

  function bracketService(options: { bracketProblem?: string | null } = {}) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const reader = createSportEventReader({
      sport: Sport.BASKETBALL,
      tournamentFormat: TournamentFormat.MATCHES,
      rounds: 4,
      gameCount: 15,
      bracketProblem: options.bracketProblem ?? null,
    });
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      reader,
    );
    return { contestCoreRepo, contestConfigurationRepo, service };
  }

  it('creates a PREDICTION bracket contest on a knockout whose games fill in as a bracket, storing only its selection type', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = bracketService();

    await service.createContest({ leagueId: 'league-1' }, bracketRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.BRACKET,
      sportEventIds: [EVENT_ID],
    }));
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.BRACKET,
      configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 1 },
      maxEntriesPerSquad: 2,
    }));
  });

  it('refuses a bracket on an event whose games cannot be filled in with 422 CONTEST_EVENT_NOT_A_BRACKET naming why, writing nothing', async () => {
    const { contestCoreRepo, service } = bracketService({ bracketProblem: 'game 3 of round 1 has a team that no pick can decide' });

    const refusal = service.createContest({ leagueId: 'league-1' }, bracketRequest());

    await expect(refusal).rejects.toMatchObject({ code: CONTEST_EVENT_NOT_A_BRACKET, statusCode: 422 });
    await expect(refusal).rejects.toThrow(/game 3 of round 1 has a team that no pick can decide/);
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a bracket over two events with 422 CONTEST_BRACKET_SINGLE_EVENT, writing nothing', async () => {
    const { contestCoreRepo, service } = bracketService();

    await expect(service.createContest({ leagueId: 'league-1' }, bracketRequest({
      sportEventIds: [EVENT_ID, '22222222-2222-2222-2222-222222222222'],
    }))).rejects.toMatchObject({ code: CONTEST_BRACKET_SINGLE_EVENT, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses BRACKET sent as a ROSTER contest with 422 CONTEST_FORMAT_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = bracketService();

    await expect(service.createContest({ leagueId: 'league-1' }, bracketRequest({ contestFormat: 'ROSTER' })))
      .rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});

describe('ContestManagementService — a second-chance bracket, started at a later round (#721)', () => {
  // Over the real event reader (the wiring's), so its bracket check and its cutoff read the event's
  // games: an eight-team, three-round knockout that tipped off two days before the clock.
  const NOW = CONTEST_MANAGEMENT_TEST_NOW;
  const HOUR = 60 * 60 * 1000;
  const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);
  /** Round 1 two days ago; round 2's first game (5) two hours from the clock, its second (6) five. */
  const KICKOFF_HOURS = new Map([[1, -48], [2, -48], [3, -46], [4, -46], [5, 2], [6, 5], [7, 50]]);

  function secondChance(options: { roundOnePlayed?: boolean; eventStatus?: SportEventStatus; eventStartHours?: number } = {}) {
    const store = new InMemorySportEvents();
    const sport = store.addSport(Sport.BASKETBALL);
    sport.tournamentFormat = TournamentFormat.MATCHES;
    const event = store.addEvent({
      sport: Sport.BASKETBALL,
      status: options.eventStatus ?? SportEventStatus.IN_PROGRESS,
      startDate: at(options.eventStartHours ?? -48),
      rounds: 3,
      participantCount: 8,
    });
    for (const [team, seed] of EIGHT_SEEDS) {
      const participant = store.addParticipant(sport.id, `Team ${team}`);
      store.addToField(event.id, participant.id, { id: team, seedNumber: seed ?? undefined });
    }
    // Round 1 played as chalk, and the results placing round 2: T1-T4 and T2-T3.
    const bracket = options.roundOnePlayed === false ? eightTeamBracket(event.id) : withResults(eightTeamBracket(event.id), new Map([
      [1, { winner: MatchSide.HOME }], [2, { winner: MatchSide.HOME }], [3, { winner: MatchSide.HOME }], [4, { winner: MatchSide.HOME }],
      [5, { home: 'T1', away: 'T4', winner: MatchSide.HOME }], [6, { home: 'T2', away: 'T3', winner: MatchSide.HOME }],
    ])).map((match) => (match.roundNumber === 2 ? { ...match, status: MatchStatus.SCHEDULED, winnerSide: null } : match));
    store.matchRows.push(...bracket.map((match) => ({ ...match, scheduledDate: at(expectDefined(KICKOFF_HOURS.get(match.matchNumber))) })));

    const world = new InMemoryContestWorld();
    const configurationRepo = createContestConfigurationRepo();
    // The rules' scoring, as it was stored: opening keeps it.
    const scoringRules: ParticipantContestScoringRule[] = [];
    const scoringRuleRepo = fakeParticipantContestScoringRuleRepo({
      findByContestConfiguration: mockFn<ParticipantContestScoringRuleRepository['findByContestConfiguration']>(async () => [...scoringRules]),
      create: mockFn<ParticipantContestScoringRuleRepository['create']>(async (rule) => {
        const created = { id: `rule-${rule.sortOrder}`, ...rule, scoring: { success: true as const, data: rule.scoring }, createdAt: NOW, updatedAt: NOW };
        scoringRules.push(created);
        return created;
      }),
    });
    let now = NOW;
    const service = new ContestManagementService(
      world.contestRepo(),
      createContestConfigTemplateRepo(),
      configurationRepo,
      scoringRuleRepo,
      createSportEventTierServiceStub(),
      undefined,
      createContestSportEventReader({
        sportEvents: store.sportEventRepo(),
        sports: store.sportRepo(),
        field: store.fieldRepo(),
        valuations: store.valuationRepo(),
        matches: store.matchRepo(),
      }),
      () => now,
    );
    const request = (startsAtRound: number): CreateContestRequest => ({
      name: 'Second chance',
      sportEventIds: [event.id],
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.BRACKET,
      configuration: {
        selectionType: SelectionType.BRACKET,
        startsAtRound,
        maxEntriesPerSquad: 1,
        scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'NONE' } } },
      },
    });
    return {
      service, world, configurationRepo, request, event,
      setNow: (when: Date) => { now = when; },
      create: (startsAtRound: number) => service.createContest({ leagueId: 'league-1' }, request(startsAtRound)),
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => undefined, (caught: unknown) => caught);
  }

  it('creates a bracket starting at round 2 on an IN_PROGRESS event before round 2\'s first game, storing its starting round', async () => {
    const context = secondChance();

    const contestId = await context.create(2);

    expect(expectDefined(context.world.contests.get(contestId))).toMatchObject({ status: ContestStatus.DRAFT, selectionType: SelectionType.BRACKET });
    expect(context.configurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 2 },
    }));
  });

  it('refuses it once round 2\'s first game time has passed with 422 SPORT_EVENT_ALREADY_STARTED, creating nothing', async () => {
    const context = secondChance();
    context.setNow(at(2.5));

    const error = await refusal(context.create(2));

    expect(error).toBeInstanceOf(ContestManagementError);
    expect(error).toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 422 });
    expect(context.world.contests.size).toBe(0);
  });

  it('refuses a starting round whose teams the results have not decided with 422 CONTEST_EVENT_NOT_A_BRACKET naming the game, creating nothing', async () => {
    const context = secondChance({ roundOnePlayed: false });

    const error = await refusal(context.create(2));

    expect(error).toMatchObject({ code: CONTEST_EVENT_NOT_A_BRACKET, statusCode: 422 });
    expect(error).toMatchObject({ message: expect.stringMatching(/game 5 of round 2 has a team that no pick can decide/) });
    expect(context.world.contests.size).toBe(0);
  });

  it('still refuses a full bracket on the event under way with 422 SPORT_EVENT_ALREADY_STARTED', async () => {
    const context = secondChance();

    expect(await refusal(context.create(1))).toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 422 });
    expect(context.world.contests.size).toBe(0);
  });

  it('refuses a starting round past the bracket\'s last round with 422 CONTEST_EVENT_NOT_A_BRACKET, creating nothing', async () => {
    // An event still to start, so the refusal is the bracket's, not the cutoff's.
    const context = secondChance({ eventStatus: SportEventStatus.SCHEDULED, eventStartHours: 24, roundOnePlayed: false });

    const error = await refusal(context.create(4));

    expect(error).toMatchObject({ code: CONTEST_EVENT_NOT_A_BRACKET, statusCode: 422 });
    expect(error).toMatchObject({ message: expect.stringMatching(/it has no games from round 4 on/) });
    expect(context.world.contests.size).toBe(0);
  });

  it('opens the second-chance draft while the event is under way, before round 2\'s first game', async () => {
    const context = secondChance();
    const contestId = await context.create(2);
    context.setNow(at(1));

    const opened = await context.service.openContest('league-1', contestId);

    expect(opened.status).toBe(ContestStatus.OPEN);
    expect(expectDefined(context.world.contests.get(contestId)).status).toBe(ContestStatus.OPEN);
  });

  it('refuses opening it once round 2\'s first game time has passed with 409 CONTEST_EVENT_ALREADY_STARTED, leaving it a draft', async () => {
    const context = secondChance();
    const contestId = await context.create(2);
    context.setNow(at(2.5));

    expect(await refusal(context.service.openContest('league-1', contestId))).toMatchObject({ code: CONTEST_EVENT_ALREADY_STARTED, statusCode: 409 });
    expect(expectDefined(context.world.contests.get(contestId)).status).toBe(ContestStatus.DRAFT);
  });
});

describe('ContestManagementService squares rules (#711)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const EVENT_ID = '11111111-1111-1111-1111-111111111111';
  const GAME_ID = '22222222-2222-2222-2222-222222222222';
  const squaresRequest = (overrides: Partial<CreateContestRequest> = {}): CreateContestRequest => ({
    name: 'Super Bowl Squares',
    sportEventIds: [EVENT_ID],
    sportEventMatchId: GAME_ID,
    contestFormat: 'SQUARES',
    selectionType: SelectionType.SQUARES,
    configuration: { selectionType: SelectionType.SQUARES, maxEntriesPerSquad: 1, maxSquaresPerEntry: 10 },
    ...overrides,
  });

  function squaresService(
    gameStatus: MatchStatus | null = MatchStatus.SCHEDULED,
    { roundNumber = 4, squaresFromRound = null }: { roundNumber?: number; squaresFromRound?: number | null } = {},
  ) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const reader = createSportEventReader({ sport: Sport.AMERICAN_FOOTBALL, tournamentFormat: TournamentFormat.MATCHES, rounds: 4, gameCount: 1, squaresFromRound });
    reader.findGame.mockImplementation(async (sportEventId: string, sportEventMatchId: string) =>
      sportEventId === EVENT_ID && sportEventMatchId === GAME_ID && gameStatus !== null ? { status: gameStatus, roundNumber } : null);
    const service = new ContestManagementService(
      contestCoreRepo,
      createContestConfigTemplateRepo(),
      contestConfigurationRepo,
      createParticipantScoringRuleRepo(),
      createSportEventTierServiceStub(),
      undefined,
      reader,
    );
    return { contestCoreRepo, contestConfigurationRepo, reader, service };
  }

  it('creates a squares contest on one of the event\'s games, storing the game and the box limit per entry', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = squaresService();

    await service.createContest({ leagueId: 'league-1' }, squaresRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.SQUARES,
      selectionType: SelectionType.SQUARES,
      squaresGameMatchId: GAME_ID,
    }));
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 },
      maxEntriesPerSquad: 1,
    }));
  });

  it.each([
    { name: 'two entries per squad', maxEntriesPerSquad: 2 },
    { name: 'no entry limit', maxEntriesPerSquad: null },
  ])('refuses a squares contest allowing $name with CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, since the box limit is a squad\'s, writing nothing', async ({ maxEntriesPerSquad }) => {
    const { contestCoreRepo, service } = squaresService();

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest({
      configuration: { selectionType: SelectionType.SQUARES, maxEntriesPerSquad, maxSquaresPerEntry: 10 },
    }))).rejects.toMatchObject({ code: CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a draft squares contest\'s settings changed to more than one entry per squad with CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, storing nothing', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = squaresService();
    await service.createContest({ leagueId: 'league-1' }, squaresRequest());
    (contestCoreRepo.findById as jest.Mock).mockResolvedValue({
      ...(await contestCoreRepo.findById('contest-1')),
      contestFormat: ContestFormat.SQUARES,
      selectionType: SelectionType.SQUARES,
      squaresGameMatchId: GAME_ID,
    });

    await expect(service.updateContestConfiguration('contest-1', { selectionType: SelectionType.SQUARES, maxEntriesPerSquad: 2, maxSquaresPerEntry: 10 }))
      .rejects.toMatchObject({ code: CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, statusCode: 422 });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });

  it('refuses a squares contest sent no game with CONTEST_SQUARES_GAME_REQUIRED, writing nothing', async () => {
    const { contestCoreRepo, service } = squaresService();
    const withoutGame = { ...squaresRequest(), sportEventMatchId: undefined };

    await expect(service.createContest({ leagueId: 'league-1' }, withoutGame))
      .rejects.toMatchObject({ code: CONTEST_SQUARES_GAME_REQUIRED });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a game that is not the event\'s', status: null },
    { name: 'a cancelled game', status: MatchStatus.CANCELLED },
  ])('refuses a squares contest on $name with CONTEST_SQUARES_GAME_INVALID, writing nothing', async ({ status }) => {
    const { contestCoreRepo, service } = squaresService(status);

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest()))
      .rejects.toMatchObject({ code: CONTEST_SQUARES_GAME_INVALID });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a squares contest on a game before its sport league\'s first squares round (a two-legged tie) with CONTEST_SQUARES_GAME_INVALID, writing nothing', async () => {
    const { contestCoreRepo, service } = squaresService(MatchStatus.SCHEDULED, { roundNumber: 4, squaresFromRound: 5 });

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest()))
      .rejects.toMatchObject({ code: CONTEST_SQUARES_GAME_INVALID, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('creates a squares contest on a game in its sport league\'s first squares round (the Champions League final)', async () => {
    const { contestCoreRepo, service } = squaresService(MatchStatus.SCHEDULED, { roundNumber: 5, squaresFromRound: 5 });

    await service.createContest({ leagueId: 'league-1' }, squaresRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({ squaresGameMatchId: GAME_ID }));
  });

  it('refuses a game sent for a contest that is not squares with CONTEST_SQUARES_GAME_INVALID', async () => {
    const { contestCoreRepo, service } = squaresService();

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest({
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.PICK_EM,
      configuration: { selectionType: SelectionType.PICK_EM, maxEntriesPerSquad: 1, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
    }))).rejects.toMatchObject({ code: CONTEST_SQUARES_GAME_INVALID });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a squares contest over more than one event with CONTEST_SQUARES_SINGLE_EVENT', async () => {
    const { contestCoreRepo, service } = squaresService();

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest({ sportEventIds: [EVENT_ID, '33333333-3333-3333-3333-333333333333'] })))
      .rejects.toMatchObject({ code: CONTEST_SQUARES_SINGLE_EVENT });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a squares contest whose game has kicked off with SPORT_EVENT_ALREADY_STARTED, though its event started long before', async () => {
    const { contestCoreRepo, reader, service } = squaresService(MatchStatus.IN_PROGRESS);
    reader.findCutoffTiming.mockImplementation(async (sportEvent: Parameters<ContestCreateSportEventReader['findCutoffTiming']>[0], cutoff: Parameters<ContestCreateSportEventReader['findCutoffTiming']>[1]) =>
      cutoffTiming(cutoff, sportEvent, [{ id: GAME_ID, roundNumber: 4, status: MatchStatus.IN_PROGRESS, scheduledDate: null }]));

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest()))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED' });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});
