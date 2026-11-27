import { withHomeAway, legacyMatch } from '../../support/match-sides';
import { expect } from '@jest/globals';
import {
  ContestFormat,
  CupWeight,
  BackgroundJobType,
  ContestStatus,
  type ContestScoringSettings,
  MatchSide,
  SlotKind,
  MatchStatus,
  type ParticipantContestScoringRule,
  type ParticipantType,
  PickEmMode,
  type ScoringFamily,
  SelectionType,
  Sport,
  SportEventStatus,
  TemplateCoverageMode,
  LeaguePlan,
  LeaguePhase,
  MatchFormat,
  type ContestTemplateSlot,
  SeasonSlotStatus,
} from '@poolmaster/shared/domain';
import {
  CONTEST_BUDGET_FIELD_OUT_OF_RANGE,
  CONTEST_BRACKET_SINGLE_EVENT,
  CONTEST_EVENTS_LOCKED,
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
  CONTEST_SELECTION_TYPE_NOT_ALLOWED,
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
  CupKey,
  ParticipantContestScoringRuleRepository,
  SportLeagueSeasonRepository,
} from '@poolmaster/shared/db';
import {
  ContestManagementError,
  ContestManagementService,
  type ContestCreateSportEventReader,
  type ContestManagementServiceDeps,
} from '../../../packages/core-api/src/modules/contest-management/service';
import type { ContestOpenedNotice } from '../../../packages/core-api/src/modules/notifications';
import type { CupService } from '../../../packages/core-api/src/modules/cups/service';
import { cutoffTiming } from '../../../packages/core-api/src/modules/contests/entry-window';
import { createBatchedContestOpeningReader, createContestSportEventReader } from '../../../packages/core-api/src/modules/contest-management/contest-sport-event-reader';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  fakeContestRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { fakeLogger } from '../../support/fake-logger';
import { expectDefined } from '../../support/expect-defined';
import { EIGHT_SEEDS, bracketMatches, eightTeamBracket, withResults } from '../../support/bracket-fixtures';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { roundSlot, weekRoundSlot } from '../../support/round-slots';
import { planEntitlementsOver, platinumEntitlements } from '../../support/plan-entitlements';
import { buildCoveredSlot, buildLeague } from '../../factories';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { testDomainEvents } from '../../support/domain-events';

const CONTEST_MANAGEMENT_TEST_NOW = new Date('2026-04-23T12:00:00.000Z');
/** What a Platinum league's contests are made and moved under: its 50 sports leagues a year (#947, #986). */
const PLATINUM_SEASON_LIMIT = expect.objectContaining({ sportLeaguesPerYear: 50 });

function createContestRepo(): ContestRepository {
  return fakeContestRepo({
    findById: jest.fn().mockResolvedValue({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventIds: ['11111111-1111-1111-1111-111111111111'],
      coveredSlotDefinitionIds: [EVENT_SLOT_DEFINITION_ID],
      coveredSeasonSlotIds: [`season-slot-${EVENT_SLOT_DEFINITION_ID}`],
      coveredSlots: [buildCoveredSlot({ slotDefinitionId: EVENT_SLOT_DEFINITION_ID })],
      name: 'Contest 1',
      status: ContestStatus.DRAFT,
      contestFormat: ContestFormat.ROSTER,
      selectionType: 'TIERED',
      sportLeagueSeasonId: 'season-2026',
      seasonYear: 2026,
      cupWeight: CupWeight.NORMAL,
      createdAt: new Date('2026-04-07T12:00:00.000Z'),
      updatedAt: new Date('2026-04-07T12:00:00.000Z'),
    }),
    create: mockFn<ContestRepository['create']>(async ({ seasonSlotIds, ...contest }) => ({
      status: 'created',
      contest: {
        id: 'contest-1',
        ...contest,
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        coveredSeasonSlotIds: [...seasonSlotIds],
        coveredSlotDefinitionIds: seasonSlotIds.map((seasonSlotId) => seasonSlotId.replace('season-slot-', '')),
        coveredSlots: seasonSlotIds.map((seasonSlotId) => buildCoveredSlot({ seasonSlotId, slotDefinitionId: seasonSlotId.replace('season-slot-', '') })),
        cupWeight: CupWeight.NORMAL,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      },
    })),
  });
}

/** The cups contest creation asks for (#841): each key handed to `ensureCup` lands in `asked`. */
function createCupKeeper(asked: CupKey[] = []): Pick<CupService, 'ensureCup'> {
  return {
    ensureCup: async (key) => {
      asked.push(key);
    },
  };
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
    findByContests: jest.fn().mockImplementation(async () => [{ ...state }]),
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

/** The slot definition the test event's one Season slot plays, which every fixture template lists. */
const EVENT_SLOT_DEFINITION_ID = 'definition-event-slot';
const EVENT_SLOT: ContestTemplateSlot = {
  id: EVENT_SLOT_DEFINITION_ID,
  key: 'TEST_EVENT',
  name: null,
  slotKind: SlotKind.TOURNAMENT,
  weekNumber: null,
  sportLeagueCompetitionId: 'competition-regular',
  competitionCode: 'REGULAR',
  competitionOrderIndex: 0,
  phase: LeaguePhase.REGULAR,
  matchFormat: MatchFormat.FIELD,
};

/** The fixture template of each selection type (#2014: every contest is made from one). */
function templateIdFor(selectionType: SelectionType): string {
  return `template-${selectionType.toLowerCase()}`;
}

/**
 * The Season slots a test contest's coverage resolves from: one per definition asked for, on the
 * test event (every event the reader answers is that one).
 */
function coverableSeasons(): Pick<SportLeagueSeasonRepository, 'findCoverableSlots'> {
  return {
    findCoverableSlots: jest.fn(async (_seasonId: string, slotDefinitionIds: readonly string[]) => slotDefinitionIds.map((slotDefinitionId) => ({
      id: `season-slot-${slotDefinitionId}`,
      slotDefinitionId,
      seasonCompetitionId: 'season-competition-regular',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      isTestData: false,
    }))),
  };
}

function createContestConfigTemplateRepo(): ContestConfigTemplateRepository {
  const template = {
    id: '11111111-1111-4111-8111-111111111111',
    sportLeagueId: PGA_TOUR_LEAGUE_ID,
    coverageMode: TemplateCoverageMode.ONE_SLOT,
    slots: [EVENT_SLOT],
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
    schemaVersion: 1,
    createdAt: new Date('2026-04-07T12:00:00.000Z'),
    updatedAt: new Date('2026-04-07T12:00:00.000Z'),
  };

  // A fixture template id names its selection type; any other id is the golf tiered template.
  const templateOf = (id: string) => {
    const selectionType = Object.values(SelectionType).find((type) => templateIdFor(type) === id);
    return selectionType === undefined ? template : { ...template, id, selectionType, templateKey: id };
  };
  return {
    findById: jest.fn(async (id: string) => templateOf(id)),
    list: jest.fn().mockResolvedValue([template]),
    update: mockFn<ContestConfigTemplateRepository['update']>(async (_id, updates) => ({
      ...template,
      ...updates,
      updatedAt: new Date('2026-04-07T12:00:01.000Z'),
    })),
    findSlotDefinitions: jest.fn().mockResolvedValue([]),
  };
}

function createParticipantScoringRuleRepo(): ParticipantContestScoringRuleRepository {
  return fakeParticipantContestScoringRuleRepo({
    findByContestConfiguration: jest.fn().mockResolvedValue([
      {
        id: 'rule-old',
        contestConfigurationId: 'config-1',
        sortOrder: 1,
        scoring: { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: { unplayedRoundToPar: 8 } } },
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
  const tiers = Array.from({ length: tierCount }, (_, index) => ({
    id: `tier-${index + 1}`,
    tierKey: `tier-${index + 1}`,
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
  }));
  return {
    listTiersOfEvents: jest.fn(async (sportEventIds: readonly string[]) => sportEventIds.flatMap((sportEventId) =>
      tiers.map(({ participants: _participants, ...tier }) => ({ ...tier, sportEventId })))),
    getEffectiveTiersForSportEvents: jest.fn(async (sportEventIds: readonly string[]) =>
      new Map(sportEventIds.map((sportEventId) => [sportEventId, tiers]))),
  } as unknown as SportEventTierService;
}

const PGA_TOUR_LEAGUE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LPGA_TOUR_LEAGUE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createSportEventReader(overrides?: Partial<{
  status: SportEventStatus;
  startDate: Date;
  sport: Sport;
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  championshipYear: number;
  playsMatches: boolean;
  participantCount: number;
  rounds: number | null;
  salaryCap: number | null;
  activeFieldPrices: number[];
  gameCount: number;
  undecidedGameCount: number;
  gamesWithoutSpreadCount: number;
  bracketProblem: string | null;
  /** Why knockout round points can't score the event; the bracket's problem unless the event is a slate of one-off games. */
  knockoutProblem: string | null;
  /** How many rounds a template's coverage covers; by default every round of the event. */
  coveredRoundCount: number;
  /** The slot definitions the event's rounds play; a template listing all of them covers every round. */
  slotDefinitionIds: string[];
  playsOnlyKnockoutRounds: boolean;
  squaresFromRound: number | null;
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
}>): {
  findById: jest.Mock;
  findByIds: jest.Mock;
  findActiveFieldPrices: jest.Mock;
  countGames: jest.Mock;
  countUndecidedGames: jest.Mock;
  countGamesWithoutSpread: jest.Mock;
  findBracketProblem: jest.Mock;
  findKnockoutProblem: jest.Mock;
  countCoveredRounds: jest.Mock;
  findCutoffTiming: jest.Mock;
  findGame: jest.Mock;
} {
  const reader = {
    findActiveFieldPrices: jest.fn().mockResolvedValue(overrides?.activeFieldPrices ?? []),
    countGames: jest.fn().mockResolvedValue(overrides?.gameCount ?? 0),
    countUndecidedGames: jest.fn().mockResolvedValue(overrides?.undecidedGameCount ?? 0),
    countGamesWithoutSpread: jest.fn().mockResolvedValue(overrides?.gamesWithoutSpreadCount ?? 0),
    findBracketProblem: jest.fn().mockResolvedValue(overrides?.bracketProblem ?? null),
    findKnockoutProblem: jest.fn().mockResolvedValue(overrides?.knockoutProblem !== undefined ? overrides.knockoutProblem : overrides?.bracketProblem ?? null),
    countCoveredRounds: jest.fn().mockResolvedValue(overrides?.coveredRoundCount ?? (overrides?.rounds === undefined ? 4 : overrides.rounds)),
    // The event's own timing for an ordinary contest; a later round's start would read its games, of which this event has none.
    findCutoffTiming: mockFn<ContestCreateSportEventReader['findCutoffTiming']>(async (sportEvent, cutoff) => cutoffTiming(cutoff, sportEvent, [])),
    findGame: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: overrides?.status ?? SportEventStatus.SCHEDULED,
      startDate: overrides?.startDate ?? new Date('2026-05-14T12:00:00.000Z'),
      sport: overrides?.sport ?? Sport.GOLF,
      sportLeagueId: overrides?.sportLeagueId ?? PGA_TOUR_LEAGUE_ID,
      sportLeagueSeasonId: overrides?.sportLeagueSeasonId ?? `season-${String(overrides?.championshipYear ?? 2026)}`,
      championshipYear: overrides?.championshipYear ?? 2026,
      playsMatches: overrides?.playsMatches ?? false,
      participantCount: overrides?.participantCount ?? 72,
      rounds: overrides?.rounds === undefined ? 4 : overrides.rounds,
      slotDefinitionIds: overrides?.slotDefinitionIds ?? [],
      playsOnlyKnockoutRounds: overrides?.playsOnlyKnockoutRounds ?? true,
      salaryCap: overrides?.salaryCap ?? null,
      squaresFromRound: overrides?.squaresFromRound ?? null,
      ...(overrides?.participantType !== undefined && { participantType: overrides.participantType }),
      ...(overrides?.scoringFamily !== undefined && { scoringFamily: overrides.scoringFamily }),
    }),
    // Each event as `findById` answers it, so a test that changes that answer changes both.
    findByIds: jest.fn(async (ids: readonly string[]): Promise<unknown[]> => (await Promise.all(ids.map((id): Promise<unknown> => (reader.findById as jest.Mock<Promise<unknown>, [string]>)(id)))).filter((state) => state !== null)),
  };
  return reader;
}

describe('ContestManagementService', () => {
  beforeAll(() => {
    // Defect pool-master-mmj: keep event readiness dates stable after the 2026 field lock date passes.
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('creates a golf tiered contest as a DRAFT in its event\'s season, makes that season\'s cup and derives internal scoring rules automatically', async () => {
    const contestCoreRepo = createContestRepo();
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();
    const cupsAsked: CupKey[] = [];

    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: contestConfigTemplateRepo,
      configurations: contestConfigurationRepo,
      scoringRules: participantContestScoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(cupsAsked),
      planEntitlements: platinumEntitlements(),
    });

    const result = await service.createContest(
      { leagueId: 'league-1' },
      {
        templateId: templateIdFor('TIERED'),
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
      sportLeagueSeasonId: 'season-2026',
      seasonSlotIds: [`season-slot-${EVENT_SLOT_DEFINITION_ID}`],
      name: 'Masters Pick 6',
      selectionType: 'TIERED',
      contestFormat: ContestFormat.ROSTER,
      status: ContestStatus.DRAFT,
      seasonYear: 2026,
    }, PLATINUM_SEASON_LIMIT);
    expect(result).toBe('contest-1');
    // Its season is its event's year, and its league gets that season's PGA Tour cup (#841).
    expect(cupsAsked).toEqual([{ leagueId: 'league-1', seasonYear: 2026, sportLeagueId: PGA_TOUR_LEAGUE_ID }]);
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: templateIdFor('TIERED'),
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
      scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: { unplayedRoundToPar: 8 } },
      active: true,
    });
  });

  it('refuses to create a tiered contest whose countedScores exceeds the event\'s tier count times picksPerTier, writing nothing', async () => {
    const contestCoreRepo = createContestRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(2),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({
        participantCount: 80,
      }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          templateId: templateIdFor('TIERED'),
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(2),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({
        participantCount: 80,
      }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          templateId: templateIdFor('TIERED'),
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    const contest = await contestCoreRepo.findById('contest-1');

    (contestCoreRepo.findById as jest.Mock).mockResolvedValueOnce({ ...contest, status });
    await expect(
      service.updateContestConfiguration('contest-1', { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 5 }),
    ).rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
    expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
  });

  describe('a sport league\'s own template (#624)', () => {
    async function createFromLeagueTemplate(templateLeagueId: string, eventLeagueId: string) {
      const contestCoreRepo = createContestRepo();
      const templateRepo = createContestConfigTemplateRepo();
      const template = await templateRepo.findById('11111111-1111-4111-8111-111111111111');
      if (!template) throw new Error('The template fake holds one template');
      jest.mocked(templateRepo.findById).mockResolvedValue({ ...template, sportLeagueId: templateLeagueId });
      const service = new ContestManagementService({
        domainEvents: testDomainEvents(),
        contests: contestCoreRepo,
        configTemplates: templateRepo,
        configurations: createContestConfigurationRepo(),
        scoringRules: createParticipantScoringRuleRepo(),
        tiers: createSportEventTierServiceStub(),
        seasons: coverableSeasons(),
        sportEventReader: createSportEventReader({ sportLeagueId: eventLeagueId }),
        cups: createCupKeeper(),
        planEntitlements: platinumEntitlements(),
      });
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

  });

  describe('setContestCupWeight', () => {
    function buildService(options?: { status?: ContestStatus; leagueId?: string; written?: boolean }) {
      const contestCoreRepo = createContestRepo();
      const contest = {
        templateId: templateIdFor('TIERED'),
        id: 'contest-1',
        leagueId: options?.leagueId ?? 'league-1',
        sportEventIds: ['11111111-1111-1111-1111-111111111111'],
        name: 'Contest 1',
        status: options?.status ?? ContestStatus.OPEN,
        contestFormat: ContestFormat.ROSTER,
        selectionType: 'TIERED',
        cupWeight: CupWeight.NORMAL as CupWeight,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      };
      (contestCoreRepo.findById as jest.Mock).mockResolvedValue(contest);
      (contestCoreRepo.setCupWeight as jest.Mock).mockImplementation(async (_id: string, cupWeight: CupWeight) => {
        if (options?.written === false) {
          return false;
        }
        contest.cupWeight = cupWeight;
        return true;
      });
      const service = new ContestManagementService({
        domainEvents: testDomainEvents(),
        contests: contestCoreRepo,
        configTemplates: createContestConfigTemplateRepo(),
        configurations: createContestConfigurationRepo(),
        scoringRules: createParticipantScoringRuleRepo(),
        tiers: createSportEventTierServiceStub(0),
        seasons: coverableSeasons(),
        sportEventReader: createSportEventReader(),
        now: () => CONTEST_MANAGEMENT_TEST_NOW,
        cups: createCupKeeper(),
        planEntitlements: platinumEntitlements(),
      });
      return { service, contestCoreRepo };
    }

    it('sets the weight of an open contest with a write guarded to unsettled statuses, and returns it with the new weight', async () => {
      const { service, contestCoreRepo } = buildService();

      const updated = await service.setContestCupWeight('league-1', 'contest-1', CupWeight.DOUBLE);

      expect(contestCoreRepo.setCupWeight).toHaveBeenCalledWith(
        'contest-1',
        CupWeight.DOUBLE,
        [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE],
      );
      expect(updated.cupWeight).toBe(CupWeight.DOUBLE);
    });

    it('refuses a completed contest with 409 CONTEST_FINAL without writing, so settled cup points never shift', async () => {
      const { service, contestCoreRepo } = buildService({ status: ContestStatus.COMPLETED });

      await expect(service.setContestCupWeight('league-1', 'contest-1', CupWeight.NOT_COUNTED))
        .rejects.toMatchObject({ code: 'CONTEST_FINAL', statusCode: 409 });
      expect(contestCoreRepo.setCupWeight).not.toHaveBeenCalled();
    });

    it('refuses with 409 CONTEST_FINAL when settlement completes the contest between the read and the guarded write', async () => {
      const { service } = buildService({ written: false });

      await expect(service.setContestCupWeight('league-1', 'contest-1', CupWeight.BONUS))
        .rejects.toMatchObject({ code: 'CONTEST_FINAL', statusCode: 409 });
    });

    it("answers another league's contest as 404 CONTEST_NOT_FOUND and leaves its weight alone", async () => {
      const { service, contestCoreRepo } = buildService({ leagueId: 'league-2' });

      await expect(service.setContestCupWeight('league-1', 'contest-1', CupWeight.DOUBLE))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
      expect(contestCoreRepo.setCupWeight).not.toHaveBeenCalled();
    });
  });

  describe('openContest', () => {
    function buildService(options?: {
      status?: ContestStatus;
      leagueId?: string;
      tierCount?: number;
      reader?: ReturnType<typeof createSportEventReader>;
      transitioned?: boolean;
      contestOpened?: ContestOpenedNotice;
      sportEventIds?: string[];
    }) {
      const contestCoreRepo = createContestRepo();
      const draft = {
        templateId: templateIdFor('TIERED'),
        id: 'contest-1',
        leagueId: options?.leagueId ?? 'league-1',
        sportEventIds: options?.sportEventIds ?? ['11111111-1111-1111-1111-111111111111'],
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
      const tiers = createSportEventTierServiceStub(options?.tierCount ?? 0);
      const service = new ContestManagementService({
        domainEvents: testDomainEvents(),
        contests: contestCoreRepo,
        configTemplates: createContestConfigTemplateRepo(),
        configurations: createContestConfigurationRepo(),
        scoringRules: createParticipantScoringRuleRepo(),
        tiers,
        seasons: coverableSeasons(),
        sportEventReader: options?.reader ?? createSportEventReader(),
        contestOpened: options?.contestOpened,
        now: () => CONTEST_MANAGEMENT_TEST_NOW,
        cups: createCupKeeper(),
        planEntitlements: platinumEntitlements(),
      });
      return { service, contestCoreRepo, tiers };
    }

    it('reads a two-event contest\'s events together and their tiers in one read when opening it, not once per event (#1355)', async () => {
      const masters = '11111111-1111-1111-1111-111111111111';
      const pga = '22222222-2222-2222-2222-222222222222';
      const reader = createSportEventReader();
      const event = await (reader.findById as jest.Mock<Promise<object>, [string]>)(masters);
      reader.findById.mockImplementation(async (id: string) => ({ ...event, id }));
      const { service, tiers } = buildService({ reader, sportEventIds: [masters, pga], tierCount: 6 });

      const opened = await service.openContest('league-1', 'contest-1');

      expect(opened.status).toBe(ContestStatus.OPEN);
      expect(reader.findByIds).toHaveBeenCalledTimes(1);
      expect(reader.findByIds).toHaveBeenCalledWith([masters, pga]);
      expect(tiers.listTiersOfEvents).toHaveBeenCalledTimes(1);
      expect(jest.mocked(tiers.listTiersOfEvents).mock.calls[0]?.[0]).toEqual([masters, pga]);
    });

    it('moves a DRAFT contest to OPEN with a compare-and-set from DRAFT, records when it opened, has the reminder sweep look at it next (#1170), and returns it open', async () => {
      const { service, contestCoreRepo } = buildService();

      const opened = await service.openContest('league-1', 'contest-1');

      expect(contestCoreRepo.transitionStatus).toHaveBeenCalledWith('contest-1', expect.objectContaining({
        from: [ContestStatus.DRAFT],
        to: ContestStatus.OPEN,
        openedAt: CONTEST_MANAGEMENT_TEST_NOW,
        nextReminderAt: CONTEST_MANAGEMENT_TEST_NOW,
      }));
      // The move carries only its boards' rebuild (#1973): the new contest email is told apart.
      const jobsOf = expectDefined(jest.mocked(contestCoreRepo.transitionStatus).mock.calls[0]?.[1].jobs);
      expect(jobsOf(['contest-1']).map((job) => job.type)).toEqual([BackgroundJobType.REBUILD_LEADERBOARDS]);
      expect(opened.status).toBe(ContestStatus.OPEN);
    });

    it('asks for the new contest email once the contest is open, and not when another press already opened it (#845)', async () => {
      const contestOpened = { contestOpened: jest.fn().mockResolvedValue(undefined) };
      await buildService({ contestOpened }).service.openContest('league-1', 'contest-1');
      expect(contestOpened.contestOpened).toHaveBeenCalledWith('contest-1');

      const raced = { contestOpened: jest.fn().mockResolvedValue(undefined) };
      await expect(buildService({ transitioned: false, contestOpened: raced }).service.openContest('league-1', 'contest-1'))
        .rejects.toMatchObject({ code: CONTEST_NOT_DRAFT });
      expect(raced.contestOpened).not.toHaveBeenCalled();
    });

    it('still opens the contest when the new contest email cannot be queued', async () => {
      const contestOpened = { contestOpened: jest.fn().mockRejectedValue(new Error('database unavailable')) };

      const opened = await buildService({ contestOpened }).service.openContest('league-1', 'contest-1');

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: participantContestScoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    expect(participantContestScoringRuleRepo.deleteByContestConfiguration).toHaveBeenCalledWith('config-1');
    expect(result.configuration).toMatchObject({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 5 });
    // pool-master-41t — the refreshed detail carries the read-only
    // effectiveTiers echo (plans/124 §5.3).
    expect(result.sportEvents[0]?.effectiveTiers).toEqual([]);
  });

  it('refuses a tiered contest update whose countedScores exceeds the event\'s tier count times picksPerTier, writing nothing', async () => {
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(2),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({
        participantCount: 80,
      }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(2),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({
        participantCount: 80,
      }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: golfTierService,
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    const result = await service.getContest('contest-1');

    expect(golfTierService.getEffectiveTiersForSportEvents).toHaveBeenCalledTimes(1);
    expect(golfTierService.getEffectiveTiersForSportEvents).toHaveBeenCalledWith(
      ['11111111-1111-1111-1111-111111111111'],
      // The set the contest picks from is its covered slots' (#2014).
      { coveredSlotDefinitionIds: ['definition-event-slot'] },
    );
    expect(result.sportEvents[0]?.effectiveTiers).toEqual([
      {
        tierKey: 'tier-1',
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

  it('reads no tiers for a contest that does not pick by tier, and echoes an empty tier list for each of its events', async () => {
    const contests = createContestRepo();
    const contest = await contests.findById('contest-1');
    (contests.findById as jest.Mock).mockResolvedValue({
      ...contest,
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.PICK_EM,
      sportEventIds: ['week-1', 'week-2', 'week-3'],
    });
    const tiers = createSportEventTierServiceStub(2, true);
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers,
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    const result = await service.getContest('contest-1');

    expect(tiers.getEffectiveTiersForSportEvents).not.toHaveBeenCalled();
    expect(result.sportEvents).toEqual([
      { sportEventId: 'week-1', effectiveTiers: [] },
      { sportEventId: 'week-2', effectiveTiers: [] },
      { sportEventId: 'week-3', effectiveTiers: [] },
    ]);
  });

  it('creates a contest from a seeded template and stores template provenance', async () => {
    const contestCoreRepo = createContestRepo();
    const contestConfigTemplateRepo = createContestConfigTemplateRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const participantContestScoringRuleRepo = createParticipantScoringRuleRepo();

    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: contestConfigTemplateRepo,
      configurations: contestConfigurationRepo,
      scoringRules: participantContestScoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: contestConfigTemplateRepo,
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
  it('refuses a create naming no template, even with a configuration, with 400 CONTEST_CONFIGURATION_REQUIRED: every contest is made from one (#2014)', async () => {
    const contestCoreRepo = createContestRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await expect(
      service.createContest(
        { leagueId: 'league-1' },
        {
          name: 'Empty create',
          sportEventIds: ['11111111-1111-1111-1111-111111111111'],
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: contestConfigTemplateRepo,
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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

    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: contestConfigTemplateRepo,
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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

    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: createContestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({
        participantCount: 0,
      }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await expect(service.createContest(
      { leagueId: 'league-1' },
      {
        templateId: templateIdFor('TIERED'),
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({ ...event, participantCount: 72 }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await expect(service.createContest(
      { leagueId: 'league-1' },
      {
        templateId: templateIdFor('TIERED'),
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
      templateId: templateIdFor('TIERED'),
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
      const service = new ContestManagementService({
        domainEvents: testDomainEvents(),
        contests: contestRepo,
        configTemplates: options.templateRepo ?? createContestConfigTemplateRepo(),
        configurations: configurationRepo,
        scoringRules: createParticipantScoringRuleRepo(),
        tiers: createSportEventTierServiceStub(),
        seasons: coverableSeasons(),
        sportEventReader: options.reader ?? createSportEventReader(),
        now: () => CONTEST_MANAGEMENT_TEST_NOW,
        cups: createCupKeeper(),
        planEntitlements: platinumEntitlements(),
      });
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

    it('refuses a new entry limit on an open squares contest before its draw with 409 CONTEST_CONFIGURATION_LOCKED: only the box limit still changes', async () => {
      const contestRepo = createContestRepo();
      const contest = await contestRepo.findById('contest-1');
      (contestRepo.findById as jest.Mock).mockResolvedValue({ ...contest, selectionType: SelectionType.SQUARES, status: ContestStatus.OPEN });
      const { service, configurationRepo } = build({ contestRepo });

      await expect(service.updateContestConfiguration('contest-1', { ...expectDefined(CREATE.configuration), maxEntriesPerSquad: 2 }))
        .rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
      expect(configurationRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 CONTEST_NOT_FOUND when a settings change finds the configuration gone on its read back', async () => {
      const configurationRepo = createContestConfigurationRepo();
      const stored = await configurationRepo.findByContest('contest-1');
      (configurationRepo.findByContest as jest.Mock).mockReset().mockResolvedValueOnce(stored).mockResolvedValueOnce(null);

      await expect(build({ configurationRepo }).service.updateContestConfiguration('contest-1', expectDefined(CREATE.configuration)))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
    });

    it('lists the sports leagues the league\'s contests use in a season as the repository counts them', async () => {
      const contestRepo = createContestRepo();
      (contestRepo.findSportLeagueIdsBySeason as jest.Mock).mockResolvedValue([PGA_TOUR_LEAGUE_ID, LPGA_TOUR_LEAGUE_ID]);

      await expect(build({ contestRepo }).service.listSportLeaguesUsed('league-1', 2026)).resolves.toEqual([PGA_TOUR_LEAGUE_ID, LPGA_TOUR_LEAGUE_ID]);
      expect(contestRepo.findSportLeagueIdsBySeason).toHaveBeenCalledWith('league-1', 2026);
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
    templateId: templateIdFor(SelectionType.BUDGET_PICK),
    name: 'Masters Budget',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'ROSTER',
    selectionType: SelectionType.BUDGET_PICK,
    configuration: { selectionType: SelectionType.BUDGET_PICK, maxEntriesPerSquad: 1, ...configuration },
  });

  function budgetService(reader: ReturnType<typeof createSportEventReader>) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: reader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
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
      templateId: templateIdFor(SelectionType.BUDGET_PICK),
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

    await expect(service.createContest({ leagueId: 'league-1' }, { ...budgetRequest({ rosterSize: 6, countedScores: 6 }), selectionType: SelectionType.TIERED, templateId: templateIdFor(SelectionType.TIERED) }))
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
    templateId: templateIdFor(SelectionType.RANDOM_DRAW),
    name: 'Masters Sweepstake',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: 'ROSTER',
    selectionType: SelectionType.RANDOM_DRAW,
    configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, ...configuration },
  });

  function drawService() {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({ salaryCap: null }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    return { contestCoreRepo, contestConfigurationRepo, service };
  }

  it('creates a golf random-draw contest storing how many golfers the draw deals each entry, with no prices or tiers needed', async () => {
    const { contestConfigurationRepo, service } = drawService();

    await service.createContest({ leagueId: 'league-1' }, drawRequest({ picksPerEntry: 3, countedScores: 2 }));

    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.RANDOM_DRAW,
      templateId: templateIdFor(SelectionType.RANDOM_DRAW),
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
    templateId: templateIdFor(SelectionType.RANDOM_DRAW),
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
      sportLeagueId: PGA_TOUR_LEAGUE_ID,
      coverageMode: TemplateCoverageMode.ONE_SLOT,
      slots: [EVENT_SLOT],
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.RANDOM_DRAW,
      templateKey: 'horse-racing-random-draw-win-place-show',
      name: 'Random draw, Win/Place/Show',
      description: 'Horse racing random draw',
      sortOrder: 3,
      isDefault: false,
      active: true,
      configJson: { ...drawRules, scoring: WIN_PLACE_SHOW },
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: templateRepo,
      configurations: createContestConfigurationRepo(),
      scoringRules: scoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({ sport: Sport.HORSE_RACING, playsMatches: false }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    return { contestCoreRepo, scoringRuleRepo, service, templateRepo };
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

  it('refuses a horse racing contest sent no scoring from a template that has none with 422 CONTEST_SCORING_SETTINGS_REQUIRED, writing nothing', async () => {
    const { contestCoreRepo, service, templateRepo } = raceService();
    const template = expectDefined(await templateRepo.findById('any'));
    jest.mocked(templateRepo.findById).mockResolvedValueOnce({ ...template, configJson: drawRules });

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest()))
      .rejects.toMatchObject({ code: CONTEST_SCORING_SETTINGS_REQUIRED, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses golf\'s to-par scoring on a horse racing contest with 422 CONTEST_SCORING_DEFINITION_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = raceService();

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({
      configuration: { ...drawRules, scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: { unplayedRoundToPar: 8 } } },
    }))).rejects.toMatchObject({ code: CONTEST_SCORING_DEFINITION_NOT_ALLOWED, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  function basketballService(rounds: number | null, bracketProblem: string | null = null, knockoutProblem: string | null = bracketProblem) {
    const contestCoreRepo = createContestRepo();
    const scoringRuleRepo = createParticipantScoringRuleRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: scoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader({ sport: Sport.BASKETBALL, playsMatches: true, rounds, bracketProblem, knockoutProblem }),
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
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

  it('creates a random draw scored by knockout round points on a slate of one-off games (a season\'s bowls), though its games form no bracket (#2225)', async () => {
    const { contestCoreRepo, scoringRuleRepo, service } = basketballService(1, 'its final has 0 games, not one', null);

    await service.createContest({ leagueId: 'league-1' }, raceRequest({ name: 'Bowl Sweepstakes', configuration: { ...drawRules, scoring: knockoutScoring([1]) } }));

    expect(contestCoreRepo.create).toHaveBeenCalled();
    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ scoring: knockoutScoring([1]) }));
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

  it('keeps a draft\'s first active scoring rule by its order when a rules update sends no scoring, passing over an inactive one', async () => {
    const { scoringRuleRepo, service } = raceService();
    const rule = (id: string, sortOrder: number, active: boolean, pointsTable: number[]): ParticipantContestScoringRule => ({
      id,
      contestConfigurationId: 'config-1',
      sortOrder,
      scoring: { success: true, data: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable, didNotFinishPoints: 0 } } },
      active,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    jest.mocked(scoringRuleRepo.findByContestConfiguration).mockResolvedValue([
      rule('rule-second', 2, true, [2]),
      rule('rule-first', 1, true, [1]),
      rule('rule-retired', 0, false, [9]),
    ]);

    await service.updateContestConfiguration('contest-1', tieredRules);

    expect(scoringRuleRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      scoring: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable: [1], didNotFinishPoints: 0 } },
    }));
  });

  it('refuses a rules update sending no scoring on a draft whose stored points table no longer reads as valid with 422 CONTEST_SCORING_SETTINGS_REQUIRED, rather than keeping it', async () => {
    const { scoringRuleRepo, service } = raceService();
    jest.mocked(scoringRuleRepo.findByContestConfiguration).mockResolvedValue([{
      id: 'rule-old',
      contestConfigurationId: 'config-1',
      sortOrder: 1,
      scoring: { success: false, reason: 'SETTINGS_INVALID', participantScoringDefinitionId: 'FINISH_POSITION_POINTS' },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    await expect(service.updateContestConfiguration('contest-1', tieredRules))
      .rejects.toMatchObject({ code: CONTEST_SCORING_SETTINGS_REQUIRED, statusCode: 422 });
    expect(scoringRuleRepo.create).not.toHaveBeenCalled();
  });

  /**
   * A knockout setup from a template that lists the event's rounds after its play-in (#2014): the
   * reader counts the event's rounds whose slot the template lists.
   */
  async function playInTemplateCreate(roundValues: number[]) {
    const templateRepo = createContestConfigTemplateRepo();
    const template = await templateRepo.findById('11111111-1111-4111-8111-111111111111');
    jest.mocked(templateRepo.findById).mockResolvedValue({
      ...expectDefined(template, 'the stub template'),
      coverageMode: TemplateCoverageMode.ALL_LISTED,
      slots: [EVENT_SLOT],
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { ...drawRules, scoring: knockoutScoring(roundValues) },
    });
    const sportEventReader = createSportEventReader({ sport: Sport.BASKETBALL, playsMatches: true, rounds: 4, coveredRoundCount: 3, slotDefinitionIds: ['play-in-definition'] });
    const contestCoreRepo = createContestRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: templateRepo,
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    const request = raceRequest({ name: 'Knockout Draw', templateId: '11111111-1111-4111-8111-111111111111', configuration: undefined });
    return { contestCoreRepo, sportEventReader, create: () => service.createContest({ leagueId: 'league-1' }, request) };
  }

  it('takes a template\'s knockout round values when they give one value per round the template covers, the play-in left out', async () => {
    const { contestCoreRepo, sportEventReader, create } = await playInTemplateCreate([1, 2, 4]);

    await create();
    expect(contestCoreRepo.create).toHaveBeenCalled();
    expect(sportEventReader.countCoveredRounds).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', { slotDefinitionIds: [EVENT_SLOT_DEFINITION_ID] });
  });

  it('refuses a template\'s knockout round values that give one value per round of the event, play-in included, with 422 CONTEST_SCORING_ROUNDS_MISMATCH', async () => {
    const { contestCoreRepo, create } = await playInTemplateCreate([1, 2, 4, 8]);

    await expect(create()).rejects.toMatchObject({ code: CONTEST_SCORING_ROUNDS_MISMATCH, statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('holds a sweepstake covering every slot of a soccer tournament to its knockout rounds, not its group matchdays, reading the rounds its games cover (#2241)', async () => {
    const templateRepo = createContestConfigTemplateRepo();
    const template = await templateRepo.findById('11111111-1111-4111-8111-111111111111');
    jest.mocked(templateRepo.findById).mockResolvedValue({
      ...expectDefined(template, 'the stub template'),
      coverageMode: TemplateCoverageMode.ALL_LISTED,
      slots: [EVENT_SLOT],
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { ...drawRules, scoring: knockoutScoring([1, 2, 4, 8, 16]) },
    });
    // Eight rounds: three group matchdays, then five knockout rounds; the template lists every slot.
    const sportEventReader = createSportEventReader({ sport: Sport.BASKETBALL, playsMatches: true, rounds: 8, coveredRoundCount: 5, slotDefinitionIds: [EVENT_SLOT_DEFINITION_ID], playsOnlyKnockoutRounds: false });
    const contestCoreRepo = createContestRepo();
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: templateRepo,
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });

    await service.createContest({ leagueId: 'league-1' }, raceRequest({ name: 'World Cup Sweep', templateId: '11111111-1111-4111-8111-111111111111', configuration: undefined }));
    expect(sportEventReader.countCoveredRounds).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', { slotDefinitionIds: [EVENT_SLOT_DEFINITION_ID] });
    expect(contestCoreRepo.create).toHaveBeenCalled();
  });

  it('refuses knockout round values on an event with no rounds with 422 CONTEST_SCORING_ROUNDS_MISMATCH, saying the event has no rounds', async () => {
    const { contestCoreRepo, service } = basketballService(null);

    await expect(service.createContest({ leagueId: 'league-1' }, raceRequest({
      name: 'Bracket Pool',
      configuration: { ...drawRules, scoring: knockoutScoring([1, 2]) },
    }))).rejects.toMatchObject({
      code: CONTEST_SCORING_ROUNDS_MISMATCH,
      statusCode: 422,
      message: expect.stringContaining('the event has no rounds'),
    });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
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
    championshipYear: number;
  }

  /** A reader over several events, each the default eligible PGA Tour event unless overridden. */
  function multiEventReader(events: Array<{ id: string; startDate: string } & Partial<ReaderEvent>>) {
    const byId = new Map(events.map((event) => [event.id, {
      status: SportEventStatus.SCHEDULED,
      sport: Sport.GOLF,
      sportLeagueId: PGA_TOUR_LEAGUE_ID,
      playsMatches: false,
      participantCount: 72,
      rounds: 4,
      salaryCap: null,
      squaresFromRound: null,
      championshipYear: 2026,
      ...event,
      sportLeagueSeasonId: `season-${String(event.championshipYear ?? 2026)}`,
      startDate: new Date(event.startDate),
    }]));
    return {
      findById: jest.fn().mockImplementation(async (id: string) => byId.get(id) ?? null),
      findByIds: jest.fn().mockImplementation(async (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? [])),
      findActiveFieldPrices: jest.fn().mockResolvedValue([10, 10, 10]),
      countGames: jest.fn().mockResolvedValue(0),
      countUndecidedGames: jest.fn().mockResolvedValue(0),
      countGamesWithoutSpread: jest.fn().mockResolvedValue(0),
      findBracketProblem: jest.fn().mockResolvedValue(null),
      findKnockoutProblem: jest.fn().mockResolvedValue(null),
      countCoveredRounds: jest.fn().mockResolvedValue(4),
      findCutoffTiming: mockFn<ContestCreateSportEventReader['findCutoffTiming']>(async (sportEvent, cutoff) => cutoffTiming(cutoff, sportEvent, [])),
      findGame: jest.fn().mockResolvedValue(null),
    };
  }

  const NEXT_MASTERS = '66666666-6666-4666-8666-666666666666';
  /** Each event's one Season slot. */
  const slotOf = (sportEventId: string) => `season-slot-${sportEventId}`;
  /** Every event's Season slot, playing the definition the template lists. */
  const eachEventsSlot = (): Pick<SportLeagueSeasonRepository, 'findCoverableSlots'> => ({
    findCoverableSlots: jest.fn(async (_seasonId: string, slotDefinitionIds: readonly string[]) => [MASTERS, PGA, US_OPEN, LPGA_MAJOR, NEXT_MASTERS]
      .flatMap((sportEventId) => slotDefinitionIds.map((slotDefinitionId) => ({
        id: slotOf(sportEventId), slotDefinitionId, seasonCompetitionId: 'season-competition-regular', sportEventId, isTestData: false,
      })))),
  });
  /** The fixture templates, covering all their listed slots: every slot of the chosen events. */
  const allListedTemplates = () => {
    const templates = createContestConfigTemplateRepo();
    const one = jest.mocked(templates.findById).getMockImplementation();
    jest.mocked(templates.findById).mockImplementation(async (id: string) => {
      const template = await expectDefined(one)(id);
      return template && { ...template, coverageMode: TemplateCoverageMode.ALL_LISTED };
    });
    return templates;
  };

  const READER_EVENTS = [
    { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z' },
    { id: PGA, startDate: '2026-05-14T12:00:00.000Z' },
    { id: US_OPEN, startDate: '2026-06-18T12:00:00.000Z' },
    { id: LPGA_MAJOR, startDate: '2026-06-25T12:00:00.000Z', sportLeagueId: LPGA_TOUR_LEAGUE_ID },
  ];

  function build(options: {
    reader?: ReturnType<typeof multiEventReader>;
    contest?: Record<string, unknown>;
    planEntitlements?: ContestManagementServiceDeps['planEntitlements'];
    storedConfigJson?: { selectionType: typeof SelectionType.BUDGET_PICK; rosterSize: number; salaryCap: number; countedScores: number };
    configTemplates?: ContestManagementServiceDeps['configTemplates'];
    seasons?: Pick<SportLeagueSeasonRepository, 'findCoverableSlots'>;
  } = {}) {
    const contestRepo = createContestRepo();
    const cupsAsked: CupKey[] = [];
    if (options.contest) {
      const contest = {
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: [MASTERS],
        name: 'Majors Pool',
        status: ContestStatus.DRAFT,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        sportLeagueSeasonId: 'season-2026',
        seasonYear: 2026,
        cupWeight: CupWeight.NORMAL,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
        ...options.contest,
      };
      const sportEventIds = contest.sportEventIds;
      (contestRepo.findById as jest.Mock).mockResolvedValue({
        ...contest,
        coveredSeasonSlotIds: sportEventIds.map(slotOf),
        coveredSlotDefinitionIds: sportEventIds.map(() => EVENT_SLOT_DEFINITION_ID),
      });
    }
    const configurationRepo = createContestConfigurationRepo();
    const logger = fakeLogger();
    if (options.storedConfigJson) {
      (configurationRepo.findByContest as jest.Mock).mockResolvedValue({
        id: 'config-1',
        contestId: 'contest-1',
        templateId: templateIdFor(options.storedConfigJson.selectionType),
        selectionType: options.storedConfigJson.selectionType,
        configJson: options.storedConfigJson,
        maxEntriesPerSquad: 1,
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        updatedAt: new Date('2026-04-07T12:00:00.000Z'),
      });
    }
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestRepo,
      configTemplates: options.configTemplates ?? allListedTemplates(),
      configurations: configurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: options.seasons ?? eachEventsSlot(),
      sportEventReader: options.reader ?? multiEventReader(READER_EVENTS),
      now: () => CONTEST_MANAGEMENT_TEST_NOW,
      cups: createCupKeeper(cupsAsked),
      planEntitlements: options.planEntitlements ?? platinumEntitlements(),
      logger,
    });
    return { service, contestRepo, configurationRepo, cupsAsked, logger };
  }

  const tiered = (sportEventIds: string[]): CreateContestRequest => ({
    templateId: templateIdFor(SelectionType.TIERED),
    name: 'Majors Pool',
    sportEventIds,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
  });

  it('creates a contest on several events of one sport league, covering each event\'s slot in play order whatever order they were sent in', async () => {
    const { service, contestRepo } = build();

    await service.createContest({ leagueId: 'league-1' }, tiered([US_OPEN, MASTERS, PGA]));

    expect(contestRepo.create).toHaveBeenCalledWith(expect.objectContaining({ seasonSlotIds: [MASTERS, PGA, US_OPEN].map(slotOf) }), PLATINUM_SEASON_LIMIT);
  });

  it('refuses a contest on events of two Seasons with 422 CONTEST_EVENTS_SEASON_MISMATCH, creating nothing', async () => {
    const { service, contestRepo } = build({
      reader: multiEventReader([...READER_EVENTS, { id: NEXT_MASTERS, startDate: '2027-04-08T12:00:00.000Z', championshipYear: 2027 }]),
    });

    await expect(service.createContest({ leagueId: 'league-1' }, tiered([MASTERS, NEXT_MASTERS])))
      .rejects.toMatchObject({ code: 'CONTEST_EVENTS_SEASON_MISMATCH', statusCode: 422 });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a contest on an event holding no slot its template lists with 422 CONTEST_COVERAGE_NO_LISTED_SLOT, creating nothing', async () => {
    const { service, contestRepo } = build({ seasons: { findCoverableSlots: jest.fn().mockResolvedValue([]) } });

    await expect(service.createContest({ leagueId: 'league-1' }, tiered([MASTERS])))
      .rejects.toMatchObject({ code: 'CONTEST_COVERAGE_NO_LISTED_SLOT', statusCode: 422 });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  it('refuses changing the event of a contest whose template is gone with 404 CONTEST_CONFIG_TEMPLATE_NOT_FOUND, changing nothing', async () => {
    const configTemplates = createContestConfigTemplateRepo();
    jest.mocked(configTemplates.findById).mockResolvedValue(null);
    const { service, contestRepo } = build({ contest: { status: ContestStatus.DRAFT }, configTemplates });

    await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] }))
      .rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_NOT_FOUND', statusCode: 404 });
    expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
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
      templateId: templateIdFor(SelectionType.RANDOM_DRAW),
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
      templateId: templateIdFor(SelectionType.BUDGET_PICK),
      name: 'Budget Majors',
      sportEventIds: [MASTERS, PGA],
      contestFormat: 'ROSTER',
      selectionType: SelectionType.BUDGET_PICK,
      configuration: { selectionType: SelectionType.BUDGET_PICK, maxEntriesPerSquad: 1, rosterSize: 2, countedScores: 2 },
    })).rejects.toMatchObject({ code: 'CONTEST_BUDGET_SALARY_CAP_MISMATCH', statusCode: 409 });
    expect(contestRepo.create).not.toHaveBeenCalled();
  });

  describe('changing the event and starting slot of a contest in Set up', () => {
    it('refuses changing the event of a contest whose configuration is gone with 404 CONTEST_NOT_FOUND, changing nothing', async () => {
      const { service, contestRepo, configurationRepo } = build({ contest: { status: ContestStatus.DRAFT } });
      jest.mocked(configurationRepo.findByContest).mockResolvedValue(null);

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] }))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
    });

    it('moves a draft to another event, covering that event\'s slot', async () => {
      const { service, contestRepo } = build({ contest: { status: ContestStatus.DRAFT } });

      await service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] });

      expect(contestRepo.replaceCoveredSlots).toHaveBeenCalledWith('contest-1', [PGA].map(slotOf), [ContestStatus.DRAFT]);
    });

    it('refuses a change once the contest has left Set up with 409 CONTEST_EVENTS_LOCKED, changing nothing', async () => {
      for (const status of [ContestStatus.OPEN, ContestStatus.ACTIVE, ContestStatus.COMPLETED]) {
        const { service, contestRepo, configurationRepo } = build({ contest: { status } });

        await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] }))
          .rejects.toMatchObject({ code: CONTEST_EVENTS_LOCKED, statusCode: 409 });
        expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
        expect(configurationRepo.update).not.toHaveBeenCalled();
      }
    });

    it('refuses a contest that opened after it was read with 409 CONTEST_EVENTS_LOCKED, its rules unchanged, since the write checks Set up again under the contest row lock', async () => {
      const { service, contestRepo, configurationRepo } = build({
        reader: multiEventReader([
          { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z', salaryCap: 100 },
          { id: PGA, startDate: '2026-05-14T12:00:00.000Z', salaryCap: 200 },
        ]),
        contest: { status: ContestStatus.DRAFT, selectionType: SelectionType.BUDGET_PICK },
        storedConfigJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 100, countedScores: 2 },
      });
      jest.mocked(contestRepo.replaceCoveredSlots).mockResolvedValue(false);

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] }))
        .rejects.toMatchObject({ code: CONTEST_EVENTS_LOCKED, statusCode: 409 });
      expect(configurationRepo.update).not.toHaveBeenCalled();
    });

    it('refuses moving a squares contest, whose game was chosen with its event, with 409 CONTEST_EVENTS_LOCKED, changing nothing', async () => {
      const { service, contestRepo } = build({
        contest: { status: ContestStatus.DRAFT, contestFormat: ContestFormat.SQUARES, selectionType: SelectionType.SQUARES, squaresGameMatchId: 'game-1' },
      });

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] }))
        .rejects.toMatchObject({ code: CONTEST_EVENTS_LOCKED, statusCode: 409 });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
    });

    it('keeps a contest in the Season it was created in: an event of another Season is refused with 422 CONTEST_EVENTS_SEASON_MISMATCH, its coverage and cups unchanged', async () => {
      const { service, contestRepo, cupsAsked } = build({
        reader: multiEventReader([...READER_EVENTS, { id: NEXT_MASTERS, startDate: '2027-04-08T12:00:00.000Z', championshipYear: 2027 }]),
        contest: { status: ContestStatus.DRAFT },
      });

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [NEXT_MASTERS] }))
        .rejects.toMatchObject({ code: 'CONTEST_EVENTS_SEASON_MISMATCH', statusCode: 422 });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
      expect(contestRepo.update).not.toHaveBeenCalled();
      expect(cupsAsked).toEqual([]);
    });

    it('refuses another sport league\'s event with CONTEST_EVENTS_LEAGUE_MISMATCH, changing nothing', async () => {
      const { service, contestRepo } = build({ contest: { status: ContestStatus.DRAFT } });

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [LPGA_MAJOR] }))
        .rejects.toMatchObject({ code: 'CONTEST_EVENTS_LEAGUE_MISMATCH' });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
    });

    it('refuses a second event on a bracket contest with 422 CONTEST_BRACKET_SINGLE_EVENT, changing nothing', async () => {
      const { service, contestRepo } = build({ contest: { contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.BRACKET } });

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [MASTERS, PGA] }))
        .rejects.toMatchObject({ code: CONTEST_BRACKET_SINGLE_EVENT, statusCode: 422 });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
    });

    it('refuses a second event on a random-draw contest with CONTEST_DRAW_SINGLE_EVENT', async () => {
      const { service, contestRepo } = build({ contest: { selectionType: SelectionType.RANDOM_DRAW } });

      await expect(service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [MASTERS, PGA] }))
        .rejects.toMatchObject({ code: 'CONTEST_DRAW_SINGLE_EVENT' });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
    });

    it('stores the new event\'s salary cap on a budget draft, so its entries are built under it', async () => {
      const { service, contestRepo, configurationRepo } = build({
        reader: multiEventReader([
          { id: MASTERS, startDate: '2026-05-01T12:00:00.000Z', salaryCap: 100 },
          { id: PGA, startDate: '2026-05-14T12:00:00.000Z', salaryCap: 200 },
        ]),
        contest: { status: ContestStatus.DRAFT, selectionType: SelectionType.BUDGET_PICK },
        storedConfigJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 100, countedScores: 2 },
      });

      await service.setContestCoverage('league-1', 'contest-1', { sportEventIds: [PGA] });

      expect(configurationRepo.update).toHaveBeenCalledWith('config-1', { configJson: expect.objectContaining({ salaryCap: 200 }) });
      expect(contestRepo.replaceCoveredSlots).toHaveBeenCalledWith('contest-1', [PGA].map(slotOf), [ContestStatus.DRAFT]);
    });

    it('answers 404 CONTEST_NOT_FOUND for another league\'s contest, changing nothing', async () => {
      const { service, contestRepo } = build({ contest: {} });

      await expect(service.setContestCoverage('league-2', 'contest-1', { sportEventIds: [PGA] }))
        .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
      expect(contestRepo.replaceCoveredSlots).not.toHaveBeenCalled();
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
    templateId: templateIdFor(SelectionType.PICK_EM),
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
    playsMatches?: boolean;
    rounds?: number;
  }) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const scoringRuleRepo = createParticipantScoringRuleRepo();
    const reader = createSportEventReader({
      sport: options.sport ?? Sport.FOOTBALL,
      playsMatches: options.playsMatches ?? true,
      rounds: options.rounds ?? 4,
      gameCount: options.gameCount,
      undecidedGameCount: options.undecidedGameCount,
      gamesWithoutSpreadCount: options.gamesWithoutSpreadCount,
    });
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: scoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: reader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
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
      configuration: { ...pickEmRules, scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: { unplayedRoundToPar: 8 } } },
    }))).rejects.toMatchObject({ code: 'CONTEST_SCORING_DEFINITION_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a pick\'em contest on a sport that offers no pick\'em (baseball) with 422 CONTEST_SELECTION_TYPE_NOT_ALLOWED, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 3, sport: Sport.BASEBALL });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules })))
      .rejects.toMatchObject({ code: CONTEST_SELECTION_TYPE_NOT_ALLOWED, statusCode: 422 });
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
    }), PLATINUM_SEASON_LIMIT);
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
      templateId: templateIdFor(SelectionType.RANDOM_DRAW),
      configuration: { selectionType: SelectionType.RANDOM_DRAW, maxEntriesPerSquad: 1, picksPerEntry: 1, countedScores: 1, scoring: knockoutScoring },
    }))).rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a PREDICTION contest on a golf event, whose slots are all FIELD so it plays no matches, with 422 CONTEST_FORMAT_NOT_ALLOWED', async () => {
    const { contestCoreRepo, service } = pickEmService({
      gameCount: 3, sport: Sport.GOLF, playsMatches: false,
    });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({ configuration: pickEmRules })))
      .rejects.toMatchObject({ code: 'CONTEST_FORMAT_NOT_ALLOWED', statusCode: 422 });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
  it('creates a PREDICTION survivor contest on a week with games, storing its selection type and, left out, that teams can be picked again once all are used and one life', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      name: 'Office Survivor',
      selectionType: SelectionType.SURVIVOR,
      templateId: templateIdFor(SelectionType.SURVIVOR),
      configuration: { selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: 1 },
    }));

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.SURVIVOR,
    }), PLATINUM_SEASON_LIMIT);
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.SURVIVOR,
      configJson: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: true, lives: 1 },
    }));
  });

  it('stores a survivor contest whose teams can never be picked again as reuseTeamsOnceAllUsed false, with the two lives it was given', async () => {
    const { contestConfigurationRepo, service } = pickEmService({ gameCount: 3 });

    await service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      name: 'Office Survivor',
      selectionType: SelectionType.SURVIVOR,
      templateId: templateIdFor(SelectionType.SURVIVOR),
      configuration: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false, lives: 2, maxEntriesPerSquad: 1 },
    }));

    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false, lives: 2 },
    }));
  });

  it('refuses a survivor contest on a week with no games with 422 CONTEST_EVENT_HAS_NO_GAMES, writing nothing', async () => {
    const { contestCoreRepo, service } = pickEmService({ gameCount: 0 });

    await expect(service.createContest({ leagueId: 'league-1' }, pickEmRequest({
      selectionType: SelectionType.SURVIVOR,
      templateId: templateIdFor(SelectionType.SURVIVOR),
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
    templateId: templateIdFor(SelectionType.BRACKET),
    name: 'March bracket',
    sportEventIds: [EVENT_ID],
    contestFormat: 'PREDICTION',
    selectionType: SelectionType.BRACKET,
    configuration: {
      selectionType: SelectionType.BRACKET,
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
      playsMatches: true,
      rounds: 4,
      gameCount: 15,
      bracketProblem: options.bracketProblem ?? null,
    });
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: reader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    return { contestCoreRepo, contestConfigurationRepo, service };
  }

  it('creates a PREDICTION bracket contest on a knockout whose games fill in as a bracket, storing only its selection type', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = bracketService();

    await service.createContest({ leagueId: 'league-1' }, bracketRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.BRACKET,
      seasonSlotIds: [`season-slot-${EVENT_SLOT_DEFINITION_ID}`],
    }), PLATINUM_SEASON_LIMIT);
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: SelectionType.BRACKET,
      configJson: { selectionType: SelectionType.BRACKET },
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

describe('ContestManagementService — a bracket on a knockout already under way', () => {
  // Over the real event reader (the wiring's), so its bracket check and its cutoff read the event's
  // games: an eight-team, three-round knockout that tipped off two days before the clock.
  const NOW = CONTEST_MANAGEMENT_TEST_NOW;
  const HOUR = 60 * 60 * 1000;
  const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);
  /** Round 1 two days ago; round 2's first game (5) two hours from the clock, its second (6) five. */
  const KICKOFF_HOURS = new Map([[1, -48], [2, -48], [3, -46], [4, -46], [5, 2], [6, 5], [7, 50]]);

  function underWay(options: { roundOnePlayed?: boolean; eventStatus?: SportEventStatus; eventStartHours?: number } = {}) {
    const store = new InMemorySportEvents();
    const sport = store.addSport(Sport.BASKETBALL);
    const event = store.addEvent({
      sport: Sport.BASKETBALL,
      status: options.eventStatus ?? SportEventStatus.IN_PROGRESS,
      startDate: at(options.eventStartHours ?? -48),
    });
    for (const [team, seed] of EIGHT_SEEDS) {
      const participant = store.addParticipant(sport.id, `Team ${team}`);
      store.addToField(event.id, participant.id, { id: team, seedNumber: seed ?? undefined });
    }
    // Round 1 played as chalk, and the results placing round 2: T1-T4 and T2-T3.
    const bracket = options.roundOnePlayed === false ? eightTeamBracket(event.id) : withResults(eightTeamBracket(event.id), new Map([
      [1, { winner: MatchSide.HOME }], [2, { winner: MatchSide.HOME }], [3, { winner: MatchSide.HOME }], [4, { winner: MatchSide.HOME }],
      [5, { home: 'T1', away: 'T4', winner: MatchSide.HOME }], [6, { home: 'T2', away: 'T3', winner: MatchSide.HOME }],
    ])).map((match) => (match.roundNumber === 2 ? withHomeAway(match, { status: MatchStatus.SCHEDULED, winnerSide: null }) : match));
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
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: world.contestRepo(),
      configTemplates: createContestConfigTemplateRepo(),
      configurations: configurationRepo,
      scoringRules: scoringRuleRepo,
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createContestSportEventReader({
        sportEvents: store.sportEventRepo(),
        field: store.fieldRepo(),
        tiers: store.tierRepo(),
        valuations: store.valuationRepo(),
        matches: store.matchRepo(),
        rounds: store.roundRepo(),
      }),
      now: () => now,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    const request = (): CreateContestRequest => ({
      templateId: templateIdFor(SelectionType.BRACKET),
      name: 'Late bracket',
      sportEventIds: [event.id],
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.BRACKET,
      configuration: {
        selectionType: SelectionType.BRACKET,
        maxEntriesPerSquad: 1,
        scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'NONE' } } },
      },
    });
    return {
      service, world, configurationRepo, request, event,
      setNow: (when: Date) => { now = when; },
      create: () => service.createContest({ leagueId: 'league-1' }, request()),
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => undefined, (caught: unknown) => caught);
  }

  it('refuses a bracket on the event under way with 422 SPORT_EVENT_ALREADY_STARTED, creating nothing', async () => {
    const context = underWay();

    expect(await refusal(context.create())).toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 422 });
    expect(context.world.contests.size).toBe(0);
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
    templateId: templateIdFor(SelectionType.SQUARES),
    name: 'Super Bowl Squares',
    sportEventIds: [EVENT_ID],
    sportEventRoundMatchId: GAME_ID,
    contestFormat: 'SQUARES',
    selectionType: SelectionType.SQUARES,
    configuration: { selectionType: SelectionType.SQUARES, maxEntriesPerSquad: 1, maxSquaresPerEntry: 10 },
    ...overrides,
  });

  function squaresService(
    gameStatus: MatchStatus | null = MatchStatus.SCHEDULED,
    { roundNumber = 4, squaresFromRound = null, gameSlotDefinitionId = EVENT_SLOT_DEFINITION_ID, configTemplates = createContestConfigTemplateRepo() }: {
      roundNumber?: number;
      squaresFromRound?: number | null;
      gameSlotDefinitionId?: string;
      configTemplates?: ContestConfigTemplateRepository;
    } = {},
  ) {
    const contestCoreRepo = createContestRepo();
    const contestConfigurationRepo = createContestConfigurationRepo();
    const reader = createSportEventReader({ sport: Sport.FOOTBALL, playsMatches: true, rounds: 4, gameCount: 1, squaresFromRound });
    reader.findGame.mockImplementation(async (sportEventId: string, sportEventRoundMatchId: string) =>
      sportEventId === EVENT_ID && sportEventRoundMatchId === GAME_ID && gameStatus !== null
        ? { status: gameStatus, roundNumber, seasonSlotId: `season-slot-${gameSlotDefinitionId}` }
        : null);
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests: contestCoreRepo,
      configTemplates,
      configurations: contestConfigurationRepo,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: reader,
      cups: createCupKeeper(),
      planEntitlements: platinumEntitlements(),
    });
    return { contestCoreRepo, contestConfigurationRepo, reader, service };
  }

  it('creates a squares contest on one of the event\'s games, storing the game and the box limit per entry', async () => {
    const { contestCoreRepo, contestConfigurationRepo, service } = squaresService();

    await service.createContest({ leagueId: 'league-1' }, squaresRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      contestFormat: ContestFormat.SQUARES,
      selectionType: SelectionType.SQUARES,
      squaresGameMatchId: GAME_ID,
    }), PLATINUM_SEASON_LIMIT);
    expect(contestConfigurationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 },
      maxEntriesPerSquad: 1,
    }));
  });

  it('covers the slot its game is played in when its event holds several slots its one-slot template lists, so no starting slot need be chosen', async () => {
    const configTemplates = createContestConfigTemplateRepo();
    const finalSlot = { ...EVENT_SLOT, id: 'definition-final', key: 'FINAL', slotKind: SlotKind.FINAL };
    const listed = await configTemplates.findById(templateIdFor(SelectionType.SQUARES));
    configTemplates.findById = jest.fn().mockResolvedValue({ ...expectDefined(listed), coverageMode: TemplateCoverageMode.ONE_SLOT, slots: [EVENT_SLOT, finalSlot] });
    const { contestCoreRepo, service } = squaresService(MatchStatus.SCHEDULED, { gameSlotDefinitionId: finalSlot.id, configTemplates });

    await service.createContest({ leagueId: 'league-1' }, squaresRequest());

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({ seasonSlotIds: ['season-slot-definition-final'] }), PLATINUM_SEASON_LIMIT);
  });

  it('covers its game\'s slot, not a different starting slot the commissioner sent, so a squares contest never covers a slot its game is not in', async () => {
    const configTemplates = createContestConfigTemplateRepo();
    const finalSlot = { ...EVENT_SLOT, id: 'definition-final', key: 'FINAL', slotKind: SlotKind.FINAL };
    const listed = await configTemplates.findById(templateIdFor(SelectionType.SQUARES));
    configTemplates.findById = jest.fn().mockResolvedValue({ ...expectDefined(listed), coverageMode: TemplateCoverageMode.ONE_SLOT, slots: [EVENT_SLOT, finalSlot] });
    const { contestCoreRepo, service } = squaresService(MatchStatus.SCHEDULED, { gameSlotDefinitionId: finalSlot.id, configTemplates });

    await service.createContest({ leagueId: 'league-1' }, squaresRequest({ startingSlotId: `season-slot-${EVENT_SLOT.id}` }));

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({ seasonSlotIds: ['season-slot-definition-final'] }), PLATINUM_SEASON_LIMIT);
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

  describe('an open squares contest before its draw', () => {
    async function openSquares() {
      const built = squaresService();
      await built.service.createContest({ leagueId: 'league-1' }, squaresRequest());
      (built.contestCoreRepo.findById as jest.Mock).mockResolvedValue({
        ...(await built.contestCoreRepo.findById('contest-1')),
        status: ContestStatus.OPEN,
        contestFormat: ContestFormat.SQUARES,
        selectionType: SelectionType.SQUARES,
        squaresGameMatchId: GAME_ID,
      });
      return built;
    }

    it('refuses settings that leave out its entry limit with 409 CONTEST_CONFIGURATION_LOCKED, since only the box limit still changes', async () => {
      const { contestConfigurationRepo, service } = await openSquares();

      await expect(service.updateContestConfiguration('contest-1', { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 5 }))
        .rejects.toMatchObject({ code: CONTEST_CONFIGURATION_LOCKED, statusCode: 409 });
      expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a box limit change on one stored with no entry limit with 422 CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, since a squares contest takes one entry per squad', async () => {
      const { contestConfigurationRepo, service } = await openSquares();
      const stored = await contestConfigurationRepo.findByContest('contest-1');
      jest.mocked(contestConfigurationRepo.findByContest).mockResolvedValue({ ...expectDefined(stored), maxEntriesPerSquad: null });

      await expect(service.updateContestConfiguration('contest-1', { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 5 }))
        .rejects.toMatchObject({ code: CONTEST_SQUARES_ONE_ENTRY_PER_SQUAD, statusCode: 422 });
      expect(contestConfigurationRepo.update).not.toHaveBeenCalled();
    });
  });

  it('refuses a squares contest sent no game with CONTEST_SQUARES_GAME_REQUIRED, writing nothing', async () => {
    const { contestCoreRepo, service } = squaresService();
    const withoutGame = { ...squaresRequest(), sportEventRoundMatchId: undefined };

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

    expect(contestCoreRepo.create).toHaveBeenCalledWith(expect.objectContaining({ squaresGameMatchId: GAME_ID }), PLATINUM_SEASON_LIMIT);
  });

  it('refuses a game sent for a contest that is not squares with CONTEST_SQUARES_GAME_INVALID', async () => {
    const { contestCoreRepo, service } = squaresService();

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest({
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.PICK_EM,
      templateId: templateIdFor(SelectionType.PICK_EM),
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
      cutoffTiming(cutoff, sportEvent, [legacyMatch({ id: GAME_ID, roundNumber: 4, status: MatchStatus.IN_PROGRESS })]));

    await expect(service.createContest({ leagueId: 'league-1' }, squaresRequest()))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED' });
    expect(contestCoreRepo.create).not.toHaveBeenCalled();
  });
});

describe('ContestManagementService sports leagues a year (#947)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(CONTEST_MANAGEMENT_TEST_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  /**
   * A Free league (1 sports league a year). Its repository answers each create as the adapter
   * would for a season already full of another sports league; the count itself is the adapter's.
   */
  function serviceForFullFreeLeague() {
    const contests = createContestRepo();
    const configurations = createContestConfigurationRepo();
    const cupsAsked: CupKey[] = [];
    contests.create = jest.fn().mockResolvedValue({ status: 'sportsLeagueLimitReached', sportLeaguesPerYear: 5, sportLeagueCount: 5 });
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests,
      configTemplates: createContestConfigTemplateRepo(),
      configurations,
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(cupsAsked),
      planEntitlements: planEntitlementsOver({ findById: async (id) => buildLeague({ id, plan: LeaguePlan.FREE }) }),
    });
    return { service, contests, configurations, cupsAsked };
  }

  const MASTERS_CONTEST: Parameters<ContestManagementService['createContest']>[1] = {
    templateId: templateIdFor(SelectionType.TIERED),
    name: 'Masters Pick 6',
    sportEventIds: ['11111111-1111-1111-1111-111111111111'],
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
  };

  it('asks the repository to create the contest within the plan\'s five sports leagues for its event\'s season, and refuses with 409 PLAN_SPORTS_LEAGUE_LIMIT_REACHED when it has no room, writing no rules or cup', async () => {
    const { service, contests, configurations, cupsAsked } = serviceForFullFreeLeague();

    await expect(service.createContest({ leagueId: 'league-1' }, MASTERS_CONTEST))
      .rejects.toMatchObject({ code: 'PLAN_SPORTS_LEAGUE_LIMIT_REACHED', statusCode: 409 });
    expect(contests.create).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', seasonYear: 2026 }),
      { sportLeaguesPerYear: 5, sportLeagueId: PGA_TOUR_LEAGUE_ID },
    );
    expect(configurations.create).not.toHaveBeenCalled();
    expect(cupsAsked).toEqual([]);
  });

  it('names a plan of one sports league a year in the singular when it refuses', async () => {
    const { service, contests } = serviceForFullFreeLeague();
    jest.mocked(contests.create).mockResolvedValue({ status: 'sportsLeagueLimitReached', sportLeaguesPerYear: 1, sportLeagueCount: 1 });

    await expect(service.createContest({ leagueId: 'league-1' }, MASTERS_CONTEST))
      .rejects.toMatchObject({ code: 'PLAN_SPORTS_LEAGUE_LIMIT_REACHED', message: expect.stringContaining('allows 1 sports league a year') });
  });

  it('asks the repository for no sports league check when the league\'s plan has no yearly limit', async () => {
    const contests = createContestRepo();
    const defaults = PLAN_SETTINGS.defaults({});
    const service = new ContestManagementService({
      domainEvents: testDomainEvents(),
      contests,
      configTemplates: createContestConfigTemplateRepo(),
      configurations: createContestConfigurationRepo(),
      scoringRules: createParticipantScoringRuleRepo(),
      tiers: createSportEventTierServiceStub(),
      seasons: coverableSeasons(),
      sportEventReader: createSportEventReader(),
      cups: createCupKeeper(),
      planEntitlements: planEntitlementsOver(
        { findById: async (id) => buildLeague({ id, plan: LeaguePlan.PLATINUM }) },
        () => ({ ...defaults, caps: { ...defaults.caps, SPORTS_LEAGUES_PER_YEAR: { ...defaults.caps.SPORTS_LEAGUES_PER_YEAR, PLATINUM: null } } }),
      ),
    });

    await service.createContest({ leagueId: 'league-1' }, MASTERS_CONTEST);

    expect(contests.create).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'league-1' }), { sportLeaguesPerYear: null });
  });
});

describe('createContestSportEventReader.findByIds (#1355, #2008)', () => {
  it('reads whether each event plays matches from its own slots, a golf tournament and a tennis draw read together', async () => {
    const store = new InMemorySportEvents();
    const golf = store.addEvent({ sport: Sport.GOLF });
    const tennis = store.addEvent({ sport: Sport.TENNIS });
    const reader = createContestSportEventReader({
      sportEvents: store.sportEventRepo(),
      field: store.fieldRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      matches: store.matchRepo(),
      rounds: store.roundRepo(),
    });

    const states = await reader.findByIds([golf.id, tennis.id]);

    expect(states.map(({ id, playsMatches }) => [id, playsMatches])).toEqual([
      [golf.id, false],
      [tennis.id, true],
    ]);
  });
});

describe('createContestSportEventReader field, game and price reads', () => {
  const EVENT = 'event-1';
  function readerOver(ports: { entries?: unknown[]; valuations?: unknown[]; games?: unknown[] }) {
    const store = new InMemorySportEvents();
    return createContestSportEventReader({
      sportEvents: store.sportEventRepo(),
      field: { findBySportEvent: async () => ports.entries ?? [] } as unknown as Parameters<typeof createContestSportEventReader>[0]['field'],
      tiers: { findTierSlots: async () => new Map([[EVENT, [{ id: 'event-slot-1', sportEventId: EVENT, seasonSlotId: 'season-slot-1', slotDefinitionId: 'slot-definition-1', seasonSlotStatus: SeasonSlotStatus.SCHEDULED, holdsTierSet: true, isTierSetSlot: true, tierLayout: null, pricing: null }]]]) },
      valuations: { findBySlot: async () => ports.valuations ?? [] } as unknown as Parameters<typeof createContestSportEventReader>[0]['valuations'],
      matches: { findBySportEvent: async () => ports.games ?? [] } as unknown as Parameters<typeof createContestSportEventReader>[0]['matches'],
      rounds: { findBySportEvent: async () => [] },
    });
  }

  it('answers null for an event it cannot find', async () => {
    await expect(readerOver({}).findById('missing')).resolves.toBeNull();
  });

  it('lists the prices of the active field only, leaving out a withdrawn golfer and an unpriced one', async () => {
    const reader = readerOver({
      entries: [{ id: 'in', status: 'ACTIVE' }, { id: 'out', status: 'WITHDRAWN' }, { id: 'unpriced', status: 'ACTIVE' }],
      valuations: [
        { sportEventParticipantId: 'in', price: 9000 },
        { sportEventParticipantId: 'out', price: 8000 },
        { sportEventParticipantId: 'unpriced', price: null },
      ],
    });

    await expect(reader.findActiveFieldPrices(EVENT)).resolves.toEqual([9000]);
  });

  it('counts the games without a spread, leaving out a cancelled one, and finds a game by id or null', async () => {
    const reader = readerOver({
      games: [
        legacyMatch({ id: 'g1', status: MatchStatus.SCHEDULED, roundNumber: 1, homeSpread: null }),
        legacyMatch({ id: 'g2', status: MatchStatus.SCHEDULED, roundNumber: 2, homeSpread: -3.5 }),
        legacyMatch({ id: 'g3', status: MatchStatus.CANCELLED, roundNumber: 1, homeSpread: null }),
      ],
    });

    await expect(reader.countGamesWithoutSpread(EVENT)).resolves.toBe(1);
    await expect(reader.findGame(EVENT, 'g2')).resolves.toEqual({ status: MatchStatus.SCHEDULED, roundNumber: 2, seasonSlotId: expect.any(String) });
    await expect(reader.findGame(EVENT, 'missing')).resolves.toBeNull();
  });
});

describe('createContestSportEventReader knockout reads over a tournament with group matchdays (#2241)', () => {
  const EVENT = 'event-tournament';
  /** Three group matchdays, then a semifinal, a third-place play-off and the final: a round per slot. */
  const ROUNDS = [weekRoundSlot(1), weekRoundSlot(2), weekRoundSlot(3), roundSlot(SlotKind.SEMIFINAL), roundSlot(SlotKind.THIRD_PLACE), roundSlot(SlotKind.FINAL)]
    .map((slot, index) => ({ roundNumber: index + 1, slot }));
  const GROUP_GAMES = bracketMatches(EVENT, [
    { matchNumber: 1, round: 1, home: 'T1', away: 'T2' },
    { matchNumber: 2, round: 2, home: 'T3', away: 'T4' },
  ], (round) => weekRoundSlot(round));
  const KNOCKOUT_GAMES = bracketMatches(EVENT, [
    { matchNumber: 3, round: 4, home: 'T1', away: 'T2', advancesTo: { matchNumber: 5, side: MatchSide.HOME } },
    { matchNumber: 4, round: 4, home: 'T3', away: 'T4', advancesTo: { matchNumber: 5, side: MatchSide.AWAY } },
    { matchNumber: 5, round: 6, home: null, away: null },
  ], (round) => round === 4 ? roundSlot(SlotKind.SEMIFINAL) : roundSlot(SlotKind.FINAL));
  const THIRD_PLACE_GAME = bracketMatches(EVENT, [{ matchNumber: 6, round: 5, home: null, away: null }], () => roundSlot(SlotKind.THIRD_PLACE));

  function readerOver(games: readonly unknown[], rounds: readonly unknown[] = ROUNDS) {
    const findRounds = jest.fn(async () => rounds);
    const reader = createContestSportEventReader({
      sportEvents: new InMemorySportEvents().sportEventRepo(),
      field: { findBySportEvent: async () => [] } as unknown as Parameters<typeof createContestSportEventReader>[0]['field'],
      tiers: { findTierSlots: async () => new Map() },
      valuations: { findBySlot: async () => [] },
      matches: { findBySportEvent: async () => games } as unknown as Parameters<typeof createContestSportEventReader>[0]['matches'],
      rounds: { findBySportEvent: findRounds } as unknown as Parameters<typeof createContestSportEventReader>[0]['rounds'],
    });
    return { reader, findRounds };
  }

  it('counts the covered knockout rounds from the event\'s rounds before any game is placed: the semifinal and the final', async () => {
    await expect(readerOver([]).reader.countCoveredRounds(EVENT, { slotDefinitionIds: ROUNDS.map((round) => round.slot.slotDefinitionId) })).resolves.toBe(2);
  });

  it('lets knockout round points take the event with only group games, reading its rounds to see it plays a knockout', async () => {
    const { reader, findRounds } = readerOver(GROUP_GAMES);

    await expect(reader.findKnockoutProblem(EVENT)).resolves.toBeNull();
    expect(findRounds).toHaveBeenCalledTimes(1);
  });

  it('refuses knockout round points on an event whose rounds are all weeks', async () => {
    await expect(readerOver(GROUP_GAMES, ROUNDS.slice(0, 3)).reader.findKnockoutProblem(EVENT)).resolves.toBe('it plays no knockout round');
  });

  it('judges a placed knockout from its games alone, without reading the rounds, and fills it in as a bracket with the group and third-place games left out', async () => {
    const { reader, findRounds } = readerOver([...GROUP_GAMES, ...KNOCKOUT_GAMES, ...THIRD_PLACE_GAME]);

    await expect(reader.findKnockoutProblem(EVENT)).resolves.toBeNull();
    await expect(reader.findBracketProblem(EVENT)).resolves.toBeNull();
    expect(findRounds).not.toHaveBeenCalled();
  });
});

describe('createContestSportEventReader event and game counts', () => {
  function readerOn(store: InMemorySportEvents, countParticipants?: () => Promise<Map<string, number>>) {
    const sportEvents = store.sportEventRepo();
    return createContestSportEventReader({
      sportEvents: countParticipants ? { ...sportEvents, countParticipants } : sportEvents,
      field: store.fieldRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      matches: store.matchRepo(),
      rounds: store.roundRepo(),
    });
  }

  function addGame(store: InMemorySportEvents, sportEventId: string, game: {
    id: string; roundNumber: number; status?: MatchStatus; scheduledDate?: Date | null; home?: string | null; away?: string | null;
  }) {
    const [row] = bracketMatches(sportEventId, [{
      matchNumber: store.matchRows.length + 1,
      round: game.roundNumber,
      home: game.home === undefined ? 'home' : game.home,
      away: game.away === undefined ? 'away' : game.away,
    }]);
    store.matchRows.push({ ...expectDefined(row, 'game row'), id: game.id, status: game.status ?? MatchStatus.SCHEDULED, scheduledDate: game.scheduledDate ?? null });
  }

  it('reads an event the participant count leaves out as having no loaded field', async () => {
    const store = new InMemorySportEvents();
    store.addSport(Sport.GOLF);
    const golf = store.addEvent({ sport: Sport.GOLF });

    const state = await readerOn(store, async () => new Map()).findById(golf.id);

    expect(state?.participantCount).toBe(0);
  });

  it('counts the games that are not cancelled, and the undecided ones in the whole event or its opening round only', async () => {
    const store = new InMemorySportEvents();
    const event = store.addEvent({});
    addGame(store, event.id, { id: 'set', roundNumber: 1 });
    addGame(store, event.id, { id: 'no-home', roundNumber: 1, home: null });
    addGame(store, event.id, { id: 'no-away', roundNumber: 2, away: null });
    addGame(store, event.id, { id: 'cancelled', roundNumber: 1, home: null, status: MatchStatus.CANCELLED });
    const reader = readerOn(store);

    await expect(reader.countGames(event.id)).resolves.toBe(3);
    await expect(reader.countUndecidedGames(event.id)).resolves.toBe(2);
    await expect(reader.countUndecidedGames(event.id, { openingRoundOnly: true })).resolves.toBe(1);
  });
});

describe('createBatchedContestOpeningReader', () => {
  const NOW = new Date('2026-09-10T12:00:00Z');

  function openingReaderOn(store: InMemorySportEvents, overrides: { countParticipants?: () => Promise<Map<string, number>> } = {}) {
    const sportEvents = store.sportEventRepo();
    return {
      reader: createBatchedContestOpeningReader({
        sportEvents: { ...sportEvents, ...overrides },
        field: store.fieldRepo(),
        tiers: store.tierRepo(),
        valuations: store.valuationRepo(),
        matches: store.matchRepo(),
        rounds: store.roundRepo(),
      }),
    };
  }

  function addGame(store: InMemorySportEvents, sportEventId: string, id: string, roundNumber: number, scheduledDate: Date, status: MatchStatus = MatchStatus.SCHEDULED) {
    const [row] = bracketMatches(sportEventId, [{ matchNumber: store.matchRows.length + 1, round: roundNumber, home: 'home', away: 'away' }]);
    store.matchRows.push({ ...expectDefined(row, 'game row'), id, status, scheduledDate });
  }

  it('reads an event the participant count leaves out as having no loaded field', async () => {
    const store = new InMemorySportEvents();
    const event = store.addEvent({});
    const { reader } = openingReaderOn(store, { countParticipants: async () => new Map() });

    await expect(reader.findById(event.id)).resolves.toEqual(expect.objectContaining({ participantCount: 0 }));
  });

  it('finds the earliest squares kickoff still to come, leaving out cancelled, started and earlier-round games', async () => {
    const store = new InMemorySportEvents();
    const event = store.addEvent({ squaresFromRound: 2, startDate: new Date('2026-09-09T00:00:00Z') });
    addGame(store, event.id, 'earlier-round', 1, new Date('2026-09-11T00:00:00Z'));
    addGame(store, event.id, 'cancelled', 2, new Date('2026-09-11T01:00:00Z'), MatchStatus.CANCELLED);
    addGame(store, event.id, 'started', 2, new Date('2026-09-10T11:00:00Z'));
    addGame(store, event.id, 'later', 3, new Date('2026-09-13T00:00:00Z'));
    addGame(store, event.id, 'next', 2, new Date('2026-09-12T00:00:00Z'));
    const { reader } = openingReaderOn(store);
    const state = expectDefined(await reader.findById(event.id), 'event state');

    await expect(reader.nextSquaresKickoff(state, NOW)).resolves.toEqual(new Date('2026-09-12T00:00:00Z'));
  });

  it('answers no squares kickoff when every game has started', async () => {
    const store = new InMemorySportEvents();
    const event = store.addEvent({ startDate: new Date('2026-09-09T00:00:00Z') });
    addGame(store, event.id, 'started', 1, new Date('2026-09-10T11:00:00Z'));
    const { reader } = openingReaderOn(store);
    const state = expectDefined(await reader.findById(event.id), 'event state');

    await expect(reader.nextSquaresKickoff(state, NOW)).resolves.toBeNull();
  });
});
