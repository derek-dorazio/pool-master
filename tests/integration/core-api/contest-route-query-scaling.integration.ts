/**
 * #1248 — a contest's leaderboards, entries and selection reads cost the same SQL statements for
 * 2 rows as for 20, which keeps the audit's fixes to them fixed (#1162, #1197, #1201).
 *
 * Each case seeds one fresh contest and scales one thing the read lists: its entries, its events
 * (a season's majors or weeks), its field, or one week's games. `rules/testing-rules.md` §9B
 * *Query Scaling Tests* says when a route needs one.
 */
import {
  ContestEntryStatus,
  ContestStatus,
  PickEmMode,
  PredictedResult,
  SelectionType,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import {
  BracketLeaderboardResponseSchema,
  ContestConfigTemplateListResponseSchema,
  ContestEntryDetailResponseSchema,
  ContestEntryListResponseSchema,
  ContestExpansionResponseSchema,
  ContestFinishedYearsResponseSchema,
  ContestLeaderboardResponseSchema,
  ContestManagementResponseSchema,
  ContestResponseSchema,
  GamePicksResponseSchema,
  LeaguePlanUsageResponseSchema,
  MyContestEntriesResponseSchema,
  PickEmLeaderboardResponseSchema,
  SelectionStateResponseSchema,
  SportLeaguesUsedResponseSchema,
  SquaresBoardResponseSchema,
  SurvivorLeaderboardResponseSchema,
} from '@poolmaster/shared/dto';
import { PrismaContestEntryMatchPredictionRepository } from '../../../packages/core-api/src/adapters';
import { expectDefined } from '../../support/expect-defined';
import { writePicks } from '../../support/prediction-writes';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { DAY, HOUR, get, okBody, seedEventWithField, seedFootballWeek, seedLeagueWithTeams, seedTiers } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());
// The template rows hold their sports league, which the cleanup would otherwise empty.
afterEach(() => getPrisma().contestConfigTemplate.deleteMany({ where: { templateKey: { startsWith: SCALING_TEMPLATE_KEY } } }));

/**
 * An ACTIVE golf roster contest over `events` majors a week apart, each team of the league in it
 * with one entry that submitted every major and picked its whole field of `golfers`, dealt into
 * `tiers` tiers. Every major but the last is played, its entry standings frozen; the last is
 * under way, scored live.
 */
async function seedRosterContest({ entries, events, golfers = 2, tiers = 2 }: { entries: number; events: number; golfers?: number; tiers?: number }) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(entries);
  const majors = [];
  for (let index = 0; index < events; index += 1) {
    const live = index === events - 1;
    const major = await seedEventWithField(golfers, {
      startsInDays: live ? -1 : -7 * (events - index),
      status: live ? SportEventStatus.IN_PROGRESS : SportEventStatus.COMPLETED,
    });
    await seedTiers(major.event.id, major.field, tiers);
    majors.push(major);
  }
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: expectDefined(majors[0]).event.startDate.getUTCFullYear(),
      sportEvents: { create: majors.map(({ event }, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      name: `Majors ${seeded.suffix}`,
      status: ContestStatus.ACTIVE,
      contestFormat: 'ROSTER',
      selectionType: SelectionType.TIERED,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: SelectionType.TIERED,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 2 },
      participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
    },
  });
  const settledAt = new Date();
  const contestEntries = [];
  for (const [index, squad] of seeded.squads.entries()) {
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squad.id,
        entryNumber: 1,
        name: squad.name,
        events: { create: majors.map(({ event }) => ({ sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date(event.startDate.getTime() - DAY) })) },
      },
    });
    await prisma.contestEntryPick.createMany({
      data: majors.flatMap(({ field }) => field.map((row, slot) => ({
        entryId: entry.id, sportEventParticipantId: row.id, contestFormat: 'ROSTER' as const, slot: slot + 1, pickedAt: settledAt,
      }))),
    });
    await prisma.contestEntryEventStanding.createMany({
      data: majors.slice(0, -1).map(({ event }) => ({
        contestId: contest.id, contestEntryId: entry.id, sportEventId: event.id, position: index + 1, displayPosition: String(index + 1),
        countingPickLimit: 2, scoredPickCount: 2, asOf: settledAt, settledAt, totalScore: index,
      })),
    });
    contestEntries.push(entry);
  }
  return { ...seeded, contest, majors, entries: contestEntries };
}

/** A league whose commissioner has a team with one draft entry in each of `contests` OPEN contests, each over `events` upcoming majors of its own. */
async function seedMyEntries({ contests, events }: { contests: number; events: number }) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(0);
  const viewer = seeded.commissioner;
  const squad = await prisma.squad.create({ data: { leagueId: seeded.league.id, createdBy: viewer.user.id, name: `Team ${seeded.suffix}` } });
  await prisma.squadMembership.create({ data: { squadId: squad.id, leagueId: seeded.league.id, userId: viewer.user.id } });
  for (let index = 0; index < contests; index += 1) {
    const majors = [];
    for (let event = 0; event < events; event += 1) majors.push(await seedEventWithField(2, { startsInDays: 30 + 7 * event }));
    await prisma.contest.create({
      data: {
        leagueId: seeded.league.id,
        seasonYear: expectDefined(majors[0]).event.startDate.getUTCFullYear(),
        sportEvents: { create: majors.map(({ event }, sequence) => ({ sportEventId: event.id, sequence: sequence + 1 })) },
        name: `Contest ${seeded.suffix} ${index}`,
        status: ContestStatus.OPEN,
        contestFormat: 'ROSTER',
        selectionType: SelectionType.TIERED,
        entries: { create: { squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: majors.map(({ event }) => ({ sportEventId: event.id })) } } },
      },
    });
  }
  return { ...seeded, viewer };
}

/**
 * A league whose commissioner runs `contests` contests of `status`, each on an event of its own in
 * a sports league of its own, `startsInDays` from now, with one entry from the commissioner's team.
 * With `secondChanceBrackets`, every other contest is a bracket starting at round 2, whose window
 * reads its rules and its event's games.
 */
async function seedContestsInSportLeagues(
  contests: number,
  { status, startsInDays, secondChanceBrackets = false }: { status: ContestStatus; startsInDays: number; secondChanceBrackets?: boolean },
) {
  const prisma = getPrisma();
  const seeded = await seedMyEntries({ contests: 0, events: 0 });
  const squad = await prisma.squad.findFirstOrThrow({ where: { leagueId: seeded.league.id } });
  const events = [];
  for (let index = 0; index < contests; index += 1) {
    const { event } = await seedEventWithField(2, { startsInDays, ownSportLeague: true });
    const bracket = secondChanceBrackets && index % 2 === 1;
    const contest = await prisma.contest.create({
      data: {
        leagueId: seeded.league.id,
        seasonYear: event.startDate.getUTCFullYear(),
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        name: `Contest ${seeded.suffix} ${index}`,
        status,
        contestFormat: bracket ? 'PREDICTION' : 'ROSTER',
        selectionType: bracket ? SelectionType.BRACKET : SelectionType.TIERED,
        entries: { create: { squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: { sportEventId: event.id } } } },
      },
    });
    if (bracket) {
      await prisma.contestConfiguration.create({
        data: { contestId: contest.id, selectionType: SelectionType.BRACKET, configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 2 } },
      });
    }
    events.push(event);
  }
  return { ...seeded, seasonYear: expectDefined(events[0]).startDate.getUTCFullYear() };
}

/** A league whose commissioner ran a contest that went final in each of `years` years, the last of them last year. */
async function seedFinishedYears(years: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(0);
  for (let offset = 1; offset <= years; offset += 1) {
    const year = new Date().getUTCFullYear() - offset;
    await prisma.contest.create({
      data: {
        leagueId: seeded.league.id,
        seasonYear: year,
        name: `Final ${seeded.suffix} ${String(year)}`,
        status: ContestStatus.COMPLETED,
        contestFormat: 'ROSTER',
        selectionType: SelectionType.TIERED,
        endsAt: new Date(`${String(year)}-06-15T16:00:00.000Z`),
      },
    });
  }
  return seeded;
}

/** `templates` active golf contest templates offered for a sports league of their own; the test deletes them. */
async function seedTemplates(templates: number) {
  const prisma = getPrisma();
  const { event } = await seedEventWithField(0, { ownSportLeague: true });
  const { sportLeagueId } = await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } });
  await prisma.contestConfigTemplate.createMany({
    data: Array.from({ length: templates }, (_, index) => ({
      sport: Sport.GOLF,
      sportLeagueId,
      contestFormat: 'ROSTER' as const,
      selectionType: SelectionType.TIERED,
      templateKey: `${SCALING_TEMPLATE_KEY}-${String(index)}`,
      name: `Scaling Template ${String(index)}`,
      description: 'A query-scaling fixture.',
      sortOrder: index,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 2 },
    })),
  });
  return { sportLeagueId, viewer: await createTestUser() };
}

const SCALING_TEMPLATE_KEY = 'query-scaling';

type PredictionType = typeof SelectionType.PICK_EM | typeof SelectionType.SURVIVOR;

const RULES_OF: Record<PredictionType, object> = {
  [SelectionType.PICK_EM]: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
  [SelectionType.SURVIVOR]: { selectionType: SelectionType.SURVIVOR },
};

/**
 * An ACTIVE pick'em or survivor contest over `weeks` NFL weeks of `games` games, each team of the
 * league in it with one entry that submitted every week: the home team in every game in a
 * pick'em pool, the first game's home team in a survivor pool. Every week but the last is played,
 * the home teams winning, and settled: a pick'em week's entry standings frozen. The last is under
 * way with its first game played.
 */
async function seedPredictionContest(selectionType: PredictionType, { entries, weeks, games = 3 }: { entries: number; weeks: number; games?: number }) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(entries);
  const season = [];
  for (let index = 0; index < weeks; index += 1) {
    const live = index === weeks - 1;
    season.push(await seedFootballWeek({
      games,
      startDate: new Date(Date.now() - (live ? 3 * HOUR : 7 * (weeks - index) * DAY)),
      status: live ? SportEventStatus.IN_PROGRESS : SportEventStatus.COMPLETED,
      played: live ? 1 : games,
    }));
  }
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: expectDefined(season[0]).event.startDate.getUTCFullYear(),
      sportEvents: { create: season.map(({ event }, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      name: `Season ${seeded.suffix}`,
      status: ContestStatus.ACTIVE,
      contestFormat: 'PREDICTION',
      selectionType,
    },
  });
  await prisma.contestConfiguration.create({ data: { contestId: contest.id, selectionType, configJson: RULES_OF[selectionType] } });
  const predictions = new PrismaContestEntryMatchPredictionRepository(getAppPrisma());
  const settledAt = new Date();
  const contestEntries = [];
  for (const squad of seeded.squads) {
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: season.map(({ event }) => ({ sportEventId: event.id })) } },
    });
    for (const week of season) {
      const picked = selectionType === SelectionType.SURVIVOR ? week.games.slice(0, 1) : week.games;
      await writePicks(predictions, {
        contestEntryId: entry.id,
        sportEventId: week.event.id,
        saves: picked.map((game) => ({
          sportEventMatchId: game.id,
          predictedResult: PredictedResult.TEAM,
          sportEventParticipantId: expectDefined(game.homeSportEventParticipantId),
          confidence: null,
        })),
        clearedMatchIds: [],
        eventStatus: ContestEntryStatus.SUBMITTED,
        at: new Date(week.event.startDate.getTime() - HOUR),
      });
    }
    if (selectionType === SelectionType.PICK_EM) {
      await prisma.contestEntryEventStanding.createMany({
        data: season.slice(0, -1).map(({ event }) => ({
          contestId: contest.id, contestEntryId: entry.id, sportEventId: event.id, position: 1, displayPosition: 'T1',
          countingPickLimit: games, scoredPickCount: games, asOf: settledAt, settledAt, totalScore: games,
        })),
      });
    }
    contestEntries.push(entry);
  }
  return { ...seeded, contest, season, entries: contestEntries };
}

/**
 * An ACTIVE bracket contest on a four-team knockout under way, its two semifinals played (the
 * home teams winning) and its final to come, each team of the league in it with one entry that
 * picked the home team of every game, the final's being the first semifinal's winner.
 */
async function seedBracketContest(entries: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(entries);
  const { event, games: semifinals } = await seedFootballWeek({
    games: 2, startDate: new Date(Date.now() - DAY), status: SportEventStatus.IN_PROGRESS, played: 2,
  });
  const [first, second] = semifinals.map((game) => expectDefined(game));
  await Promise.all([first, second].map((game, index) => prisma.sportEventParticipant.update({
    where: { id: expectDefined(game.homeSportEventParticipantId) }, data: { seedNumber: index + 1 },
  })));
  const finalRound = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date(Date.now() + DAY) } });
  const final = await prisma.sportEventMatch.create({
    data: {
      sportEventId: event.id, sportEventRoundId: finalRound.id, matchNumber: 3, isNeutralSite: true,
      homeSportEventParticipantId: first.homeSportEventParticipantId, awaySportEventParticipantId: second.homeSportEventParticipantId,
    },
  });
  await prisma.sportEventMatch.update({ where: { id: first.id }, data: { advancesToMatchId: final.id, advancesToSide: 'HOME' } });
  await prisma.sportEventMatch.update({ where: { id: second.id }, data: { advancesToMatchId: final.id, advancesToSide: 'AWAY' } });
  await prisma.sportEvent.update({ where: { id: event.id }, data: { rounds: 2 } });
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: event.startDate.getUTCFullYear(),
      sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
      name: `Bracket ${seeded.suffix}`,
      status: ContestStatus.ACTIVE,
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.BRACKET,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: SelectionType.BRACKET,
      configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 1 },
      participantScoringRules: {
        create: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', sortOrder: 1, config: { roundValues: [1, 2], upsetBonus: { rule: 'NONE' } } },
      },
    },
  });
  const predictions = new PrismaContestEntryMatchPredictionRepository(getAppPrisma());
  for (const squad of seeded.squads) {
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: { sportEventId: event.id } } },
    });
    await writePicks(predictions, {
      contestEntryId: entry.id,
      sportEventId: event.id,
      saves: [first, second, final].map((game) => ({
        sportEventMatchId: game.id,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: expectDefined(game.homeSportEventParticipantId),
        confidence: null,
      })),
      clearedMatchIds: [],
      eventStatus: ContestEntryStatus.SUBMITTED,
      at: new Date(event.startDate.getTime() - HOUR),
    });
  }
  return { ...seeded, contest };
}

/** An OPEN squares contest on next month's game, each team of the league in it with one entry holding one box. */
async function seedSquaresContest(entries: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(entries);
  const { event, games: [game] } = await seedFootballWeek({ games: 1, startDate: new Date(Date.now() + 30 * DAY), status: SportEventStatus.SCHEDULED });
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: event.startDate.getUTCFullYear(),
      sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
      squaresGame: { create: { sportEventMatchId: expectDefined(game).id } },
      name: `Squares ${seeded.suffix}`,
      status: ContestStatus.OPEN,
      contestFormat: 'SQUARES',
      selectionType: SelectionType.SQUARES,
    },
  });
  await prisma.contestConfiguration.create({
    data: { contestId: contest.id, selectionType: SelectionType.SQUARES, configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 } },
  });
  for (const [index, squad] of seeded.squads.entries()) {
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: { sportEventId: event.id } } },
    });
    await prisma.contestEntrySquare.create({
      data: { contestId: contest.id, contestEntryId: entry.id, rowIndex: Math.floor(index / 10), columnIndex: index % 10, claimedByUserId: seeded.commissioner.user.id },
    });
  }
  return { ...seeded, contest };
}

describe('contest reads cost the same statements for 2 rows as for 20', () => {
  it("GET a roster contest's leaderboard: the same statements for 2 entries as for 20 (#1162)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/leaderboard',
      seed: (entries) => seedRosterContest({ entries, events: 2 }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, ContestLeaderboardResponseSchema).entries.length,
    });
  });

  it("GET a roster contest's leaderboard: the same statements for 2 majors as for 20 (#1162)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/leaderboard',
      seed: (events) => seedRosterContest({ entries: 2, events }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/leaderboard`, commissioner),
      rowsShown: (response) => expectDefined(okBody(response, ContestLeaderboardResponseSchema).entries[0]).events.length,
    });
  });

  it("GET a contest's entries: the same statements for 2 entries as for 20 (#1197)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/entries',
      seed: (entries) => seedRosterContest({ entries, events: 2 }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/entries`, commissioner),
      rowsShown: (response) => okBody(response, ContestEntryListResponseSchema).entries.length,
    });
  });

  it("GET a contest's entries: the same statements for 2 majors' picks as for 20 (#1197)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/entries',
      seed: (events) => seedRosterContest({ entries: 2, events }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/entries`, commissioner),
      rowsShown: (response) => okBody(response, ContestEntryListResponseSchema).entries
        .reduce((total, entry) => total + (entry.participants?.length ?? 0), 0),
    });
  });

  it('GET one entry: the same statements for its picks in 2 majors as in 20 (#1197)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/entries/{entryId}',
      seed: (events) => seedRosterContest({ entries: 1, events }),
      call: ({ contest, entries, commissioner }) => get(`/api/v1/contests/${contest.id}/entries/${expectDefined(entries[0]).id}`, commissioner),
      rowsShown: (response) => okBody(response, ContestEntryDetailResponseSchema).entry.participants?.length ?? 0,
    });
  });

  it('GET a contest: the same statements for 2 majors as for 20 (#1197)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}',
      seed: (events) => seedRosterContest({ entries: 2, events }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}`, commissioner),
      rowsShown: (response) => okBody(response, ContestResponseSchema).contest.sportEvents.length,
    });
  });

  it("GET my entries in a league's current contests: the same statements for 2 contests as for 20 (#1197)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/my-entries',
      seed: (contests) => seedMyEntries({ contests, events: 1 }),
      call: ({ league, viewer }) => get(`/api/v1/leagues/${league.id}/contests/my-entries`, viewer),
      rowsShown: (response) => okBody(response, MyContestEntriesResponseSchema).entries.length,
    });
  });

  it("GET my entries in a league's current contests: the same statements for a contest of 2 majors as of 20 (#1197)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/my-entries',
      seed: (events) => seedMyEntries({ contests: 1, events }),
      call: ({ league, viewer }) => get(`/api/v1/leagues/${league.id}/contests/my-entries`, viewer),
      rowsShown: (response) => expectDefined(okBody(response, MyContestEntriesResponseSchema).entries[0]).events.length,
    });
  });

  it("GET a major's selection room: the same statements for 2 entries as for 20 (#1201)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/selections/{contestId}',
      seed: (entries) => seedRosterContest({ entries, events: 1 }),
      call: ({ contest, commissioner }) => get(`/api/v1/selections/${contest.id}`, commissioner),
      rowsShown: (response) => okBody(response, SelectionStateResponseSchema).entries.length,
    });
  });

  it("GET a major's selection room: the same statements for a field of 2 as of 20 (#1201)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/selections/{contestId}',
      seed: (golfers) => seedRosterContest({ entries: 1, events: 1, golfers }),
      call: ({ contest, commissioner }) => get(`/api/v1/selections/${contest.id}`, commissioner),
      rowsShown: (response) => okBody(response, SelectionStateResponseSchema).pickHistories.length,
    });
  });

  it("GET a league's finished-contest years: the same statements for 2 years as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/finished-years',
      seed: seedFinishedYears,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/contests/finished-years`, commissioner),
      rowsShown: (response) => okBody(response, ContestFinishedYearsResponseSchema).years.length,
    });
  });

  it("GET the sports leagues a season's contests use: the same statements for 2 sports leagues as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/sports-leagues-used',
      seed: (contests) => seedContestsInSportLeagues(contests, { status: ContestStatus.OPEN, startsInDays: 30 }),
      call: ({ league, seasonYear, viewer }) => get(`/api/v1/leagues/${league.id}/contests/sports-leagues-used?seasonYear=${String(seasonYear)}`, viewer),
      rowsShown: (response) => okBody(response, SportLeaguesUsedResponseSchema).sportLeagueIds.length,
    });
  });

  it("GET a league's plan usage: the same statements for 2 open contests in 2 sports leagues as for 20 in 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/plan-usage',
      // Within the hour, so the events start this year however late in it the test runs.
      seed: (contests) => seedContestsInSportLeagues(contests, { status: ContestStatus.OPEN, startsInDays: 1 / 24 }),
      call: ({ league, viewer }) => get(`/api/v1/leagues/${league.id}/contests/plan-usage`, viewer),
      rowsShown: (response) => {
        const usage = okBody(response, LeaguePlanUsageResponseSchema);
        return Math.min(usage.openContests.length, usage.sportLeagueIds.length);
      },
    });
  });

  it("GET a league's plan usage: the same statements for 2 open contests in 2 sports leagues as for 20 in 20, half of them second-chance brackets", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/plan-usage',
      // Within the hour, so the events start this year however late in it the test runs.
      seed: (contests) => seedContestsInSportLeagues(contests, { status: ContestStatus.OPEN, startsInDays: 1 / 24, secondChanceBrackets: true }),
      call: ({ league, viewer }) => get(`/api/v1/leagues/${league.id}/contests/plan-usage`, viewer),
      rowsShown: (response) => {
        const usage = okBody(response, LeaguePlanUsageResponseSchema);
        return Math.min(usage.openContests.length, usage.sportLeagueIds.length);
      },
    });
  });

  it("GET a contest's entry cap and expansions: the same statements for 2 entries as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/billing/contests/{contestId}/expansion',
      seed: (entries) => seedRosterContest({ entries, events: 1 }),
      call: ({ league, contest, commissioner }) => get(`/api/v1/leagues/${league.id}/billing/contests/${contest.id}/expansion`, commissioner),
      rowsShown: (response) => okBody(response, ContestExpansionResponseSchema).entryCount,
    });
  });

  it("GET a contest to manage: the same statements for 2 majors' tiers as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contest-management/contests/{contestId}',
      seed: (events) => seedRosterContest({ entries: 1, events }),
      call: ({ league, contest, commissioner }) => get(`/api/v1/leagues/${league.id}/contest-management/contests/${contest.id}`, commissioner),
      rowsShown: (response) => okBody(response, ContestManagementResponseSchema).contest.sportEvents.length,
    });
  });

  it('GET a contest to manage: the same statements for 2 tiers as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contest-management/contests/{contestId}',
      seed: (tiers) => seedRosterContest({ entries: 1, events: 1, golfers: tiers, tiers }),
      call: ({ league, contest, commissioner }) => get(`/api/v1/leagues/${league.id}/contest-management/contests/${contest.id}`, commissioner),
      rowsShown: (response) => expectDefined(okBody(response, ContestManagementResponseSchema).contest.sportEvents[0]).effectiveTiers.length,
    });
  });

  it("GET a sports league's contest templates: the same statements for 2 templates as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contest-config-templates/',
      seed: seedTemplates,
      call: ({ sportLeagueId, viewer }) => get(`/api/v1/contest-config-templates/?sport=${Sport.GOLF}&sportLeagueId=${sportLeagueId}`, viewer),
      rowsShown: (response) => okBody(response, ContestConfigTemplateListResponseSchema).templates.length,
    });
  });

  it("GET a pick'em leaderboard: the same statements for 2 entries as for 20 (#1162)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/pick-em-leaderboard',
      seed: (entries) => seedPredictionContest(SelectionType.PICK_EM, { entries, weeks: 2 }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/pick-em-leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, PickEmLeaderboardResponseSchema).entries.length,
    });
  });

  it("GET a pick'em leaderboard: the same statements for 2 weeks as for 20 (#1162)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/pick-em-leaderboard',
      seed: (weeks) => seedPredictionContest(SelectionType.PICK_EM, { entries: 2, weeks }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/pick-em-leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, PickEmLeaderboardResponseSchema).weeks.length,
    });
  });

  it('GET a survivor leaderboard: the same statements for 2 entries as for 20 (#1162)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/survivor-leaderboard',
      seed: (entries) => seedPredictionContest(SelectionType.SURVIVOR, { entries, weeks: 2 }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/survivor-leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, SurvivorLeaderboardResponseSchema).entries.length,
    });
  });

  it('GET a survivor leaderboard: the same statements for 2 weeks as for 20 (#1162)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/survivor-leaderboard',
      seed: (weeks) => seedPredictionContest(SelectionType.SURVIVOR, { entries: 2, weeks }),
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/survivor-leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, SurvivorLeaderboardResponseSchema).weeks.length,
    });
  });

  it("GET an entry's game picks for a week: the same statements for 2 games as for 20 (#1201)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/selections/{contestId}/entries/{entryId}/events/{sportEventId}/game-picks',
      seed: (games) => seedPredictionContest(SelectionType.PICK_EM, { entries: 1, weeks: 1, games }),
      call: ({ contest, entries, season, commissioner }) => get(
        `/api/v1/selections/${contest.id}/entries/${expectDefined(entries[0]).id}/events/${expectDefined(season[0]).event.id}/game-picks`,
        commissioner,
      ),
      rowsShown: (response) => okBody(response, GamePicksResponseSchema).games.length,
    });
  });

  it('GET a bracket leaderboard: the same statements for 2 entries as for 20 (#1162)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/contests/{contestId}/bracket-leaderboard',
      seed: seedBracketContest,
      call: ({ contest, commissioner }) => get(`/api/v1/contests/${contest.id}/bracket-leaderboard`, commissioner),
      rowsShown: (response) => okBody(response, BracketLeaderboardResponseSchema).entries.length,
    });
  });

  it("GET a squares grid: the same statements for 2 entries' boxes as for 20 (#1201)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/selections/{contestId}/squares',
      seed: seedSquaresContest,
      call: ({ contest, commissioner }) => get(`/api/v1/selections/${contest.id}/squares`, commissioner),
      rowsShown: (response) => okBody(response, SquaresBoardResponseSchema).boxes.length,
    });
  });
});
