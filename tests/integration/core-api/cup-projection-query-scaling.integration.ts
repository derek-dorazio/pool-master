/**
 * #1315 — a cup's "if it ended now" projection costs the same SQL statements for 2 live contests
 * as for 20. It used to build each live contest's leaderboard on its own, about 20 statements a
 * contest, so a busy week multiplied the cup page's cost.
 *
 * Each case seeds one league whose open cup counts `rows` live contests of one selection type,
 * each on an event of its own under way, with both teams entered: each selection type builds its
 * leaderboard from reads of its own. In every contest the first team is ahead and the second
 * behind, so the batched boards are checked against the places each contest gives.
 * `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
// First, before the app is built: no leaderboard is kept, so each board below is computed afresh.
import '../leaderboard-cache-off';
import { ContestEntryStatus, ContestStatus, PickEmMode, PredictedResult, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { CupProjectionResponseSchema } from '@poolmaster/shared/dto';
import type { Response } from 'light-my-request';
import { PrismaContestEntryMatchPredictionRepository } from '../../../packages/core-api/src/adapters';
import { createContestService } from '../../../packages/core-api/src/modules/contests/wiring';
import { expectDefined } from '../../support/expect-defined';
import { writePicks } from '../../support/prediction-writes';
import { cleanupTestData, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, HOUR, get, okBody, seedEventWithField, seedFootballWeek, seedLeagueWithTeams, seedTiers } from '../list-route-seeds';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { expectConstantQueries } from '../query-scaling';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The league a live cup's contests are seeded in. */
type CupLeague = Awaited<ReturnType<typeof seedLeagueWithTeams>>;

/** A live contest seeded in the cup's league, with its event's sports league and season. */
interface LiveContest {
  contestId: string;
  sportLeagueId: string;
  seasonYear: number;
}

/** Seeds one live contest in the league, its first team ahead of its second. */
type LiveContestSeed = (seeded: CupLeague, index: number) => Promise<LiveContest>;

/** A league of two teams whose open cup counts `contests` live contests, each seeded by `seedContest` on an event of its own. */
async function seedLiveCup(contests: number, seedContest: LiveContestSeed) {
  const seeded = await seedLeagueWithTeams(2);
  const live: LiveContest[] = [];
  for (let index = 0; index < contests; index += 1) live.push(await seedContest(seeded, index));
  const { sportLeagueId, seasonYear } = expectDefined(live[0]);
  const cup = await getPrisma().cup.create({ data: { leagueId: seeded.league.id, sportLeagueId, seasonYear } });
  return { ...seeded, cup };
}

/** The season and sports league an event counts in. */
async function cupOf(event: { eventSeriesId: string; startDate: Date }): Promise<Omit<LiveContest, 'contestId'>> {
  const { sportLeagueId } = await getPrisma().eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } });
  return { sportLeagueId, seasonYear: event.startDate.getUTCFullYear() };
}

type RosterType = typeof SelectionType.TIERED | typeof SelectionType.BUDGET_PICK | typeof SelectionType.RANDOM_DRAW;

/** Each roster type's rules: two golfers an entry, both counting. */
const ROSTER_RULES = {
  [SelectionType.TIERED]: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 2 },
  [SelectionType.BUDGET_PICK]: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 100, countedScores: 2 },
  [SelectionType.RANDOM_DRAW]: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 2, countedScores: 2 },
} as const;

/**
 * An ACTIVE golf roster contest of `selectionType` on a major that started yesterday, its four
 * golfers each a stroke behind the last (with `tied`, all level), dealt into two tiers. Each team
 * has a lineup: the first team the leading two golfers, the second the trailing two, submitted or,
 * in a quick pick, dealt by its draw. Nothing has settled, so it scores live.
 */
function liveRosterContest(selectionType: RosterType, { tied = false }: { tied?: boolean } = {}): LiveContestSeed {
  return async (seeded, index) => {
    const prisma = getPrisma();
    const { event, field } = await seedEventWithField(4, { startsInDays: -1, status: SportEventStatus.IN_PROGRESS });
    await seedTiers(event.id, field, 2);
    for (const [scoreToPar, row] of field.entries()) {
      await prisma.sportEventParticipantStanding.create({
        data: {
          sportEventParticipantId: row.id,
          currentRound: 1,
          asOf: new Date(),
          golf: { create: { eventScoreToPar: tied ? 0 : scoreToPar, eventStrokes: 72 + (tied ? 0 : scoreToPar), currentRoundThru: 9 } },
        },
      });
    }
    const contest = await prisma.contest.create({
      data: {
        leagueId: seeded.league.id,
        seasonYear: event.startDate.getUTCFullYear(),
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        name: `Live Major ${seeded.suffix} ${String(index)}`,
        status: ContestStatus.ACTIVE,
        contestFormat: 'ROSTER',
        selectionType,
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType,
        configJson: ROSTER_RULES[selectionType],
        participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
      },
    });
    const entryIds: string[] = [];
    for (const [team, squad] of seeded.squads.entries()) {
      const entry = await prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squad.id,
          entryNumber: 1,
          name: squad.name,
          events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date(event.startDate.getTime() - DAY) } },
        },
      });
      entryIds.push(entry.id);
      await prisma.contestEntryPick.createMany({
        data: field.slice(2 * team, 2 * team + 2).map((row, slot) => ({
          entryId: entry.id, sportEventParticipantId: row.id, contestFormat: 'ROSTER' as const, slot: slot + 1, pickedAt: new Date(),
          isAutoPicked: selectionType === SelectionType.RANDOM_DRAW,
        })),
      });
    }
    if (selectionType === SelectionType.RANDOM_DRAW) {
      await prisma.contestDraw.create({
        data: { contestId: contest.id, seed: `scaling-${seeded.suffix}`, fieldOrder: field.map((row) => row.id), entryOrder: entryIds, drawnAt: new Date(event.startDate.getTime() - DAY) },
      });
    }
    return { contestId: contest.id, ...(await cupOf(event)) };
  };
}

const PREDICTION_RULES = {
  [SelectionType.PICK_EM]: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
  [SelectionType.SURVIVOR]: { selectionType: SelectionType.SURVIVOR },
} as const;

/**
 * An ACTIVE pick'em or survivor contest on an NFL week under way, its first game played with the
 * home team winning. Each team submitted the week: the first team the home team in every game
 * (in a survivor pool, the first game's), the second the away team.
 */
function livePredictionContest(selectionType: typeof SelectionType.PICK_EM | typeof SelectionType.SURVIVOR): LiveContestSeed {
  return async (seeded, index) => {
    const prisma = getPrisma();
    const week = await seedFootballWeek({ games: 2, startDate: new Date(Date.now() - 3 * HOUR), status: SportEventStatus.IN_PROGRESS, played: 1 });
    const contest = await prisma.contest.create({
      data: {
        leagueId: seeded.league.id,
        seasonYear: week.event.startDate.getUTCFullYear(),
        sportEvents: { create: { sportEventId: week.event.id, sequence: 1 } },
        name: `Live Week ${seeded.suffix} ${String(index)}`,
        status: ContestStatus.ACTIVE,
        contestFormat: 'PREDICTION',
        selectionType,
      },
    });
    await prisma.contestConfiguration.create({ data: { contestId: contest.id, selectionType, configJson: PREDICTION_RULES[selectionType] } });
    const games = selectionType === SelectionType.SURVIVOR ? week.games.slice(0, 1) : week.games;
    for (const [team, squad] of seeded.squads.entries()) {
      const entry = await prisma.contestEntry.create({
        data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: { sportEventId: week.event.id } } },
      });
      await savePicks(entry.id, week.event, games.map((game) => ({ game, team: team === 0 ? game.homeSportEventParticipantId : game.awaySportEventParticipantId })));
    }
    return { contestId: contest.id, ...(await cupOf(week.event)) };
  };
}

/**
 * An ACTIVE bracket contest on a four-team knockout under way, its semifinals played (the home
 * teams winning) and its final to come. The first team picked the home team of every game, the
 * second the away team of each semifinal.
 */
const liveBracketContest: LiveContestSeed = async (seeded, index) => {
  const prisma = getPrisma();
  const { event, games: semifinals } = await seedFootballWeek({ games: 2, startDate: new Date(Date.now() - DAY), status: SportEventStatus.IN_PROGRESS, played: 2 });
  const [first, second] = semifinals.map((game) => expectDefined(game));
  await Promise.all([first, second].map((game, seed) => prisma.sportEventParticipant.update({
    where: { id: expectDefined(game.homeSportEventParticipantId) }, data: { seedNumber: seed + 1 },
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
      name: `Live Bracket ${seeded.suffix} ${String(index)}`,
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
  const picksOf = [
    [first, second, final].map((game) => ({ game, team: game.homeSportEventParticipantId })),
    [first, second].map((game) => ({ game, team: game.awaySportEventParticipantId })),
  ];
  for (const [team, squad] of seeded.squads.entries()) {
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: { sportEventId: event.id } } },
    });
    await savePicks(entry.id, event, expectDefined(picksOf[team]));
  }
  return { contestId: contest.id, ...(await cupOf(event)) };
};

/** The entry's submitted picks: each `team` to win its `game`. */
async function savePicks(contestEntryId: string, event: { id: string; startDate: Date }, picks: readonly { game: { id: string }; team: string | null }[]) {
  await writePicks(new PrismaContestEntryMatchPredictionRepository(getPrisma()), {
    contestEntryId,
    sportEventId: event.id,
    saves: picks.map(({ game, team }) => ({
      sportEventMatchId: game.id,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: expectDefined(team ?? undefined),
      confidence: null,
    })),
    clearedMatchIds: [],
    eventStatus: ContestEntryStatus.SUBMITTED,
    at: new Date(event.startDate.getTime() - HOUR),
  });
}

/** The projection's scaling case for a cup of live contests seeded by `seedContest`. */
function projectionCase(seedContest: LiveContestSeed) {
  return {
    route: 'GET /api/v1/leagues/{id}/cups/{cupId}/projection' as const,
    seed: (contests: number) => seedLiveCup(contests, seedContest),
    call: ({ league, cup, commissioner }: Awaited<ReturnType<typeof seedLiveCup>>) => get(`/api/v1/leagues/${league.id}/cups/${cup.id}/projection`, commissioner),
    rowsShown: (response: Response) => {
      const { projection } = okBody(response, CupProjectionResponseSchema);
      // The first team leads every live contest, so each one reached its leaderboard read.
      expect(expectDefined(projection.standings[0]).gained).toBeGreaterThan(expectDefined(projection.standings[1]).gained);
      return projection.contests.length;
    },
  };
}

describe("a cup's projection costs the same statements for 2 live contests as for 20", () => {
  it('GET a cup projection over live tiered roster contests: the same statements for 2 contests as for 20 (#1315)', async () => {
    await expectConstantQueries(projectionCase(liveRosterContest(SelectionType.TIERED)));
  });

  it('GET a cup projection over live budget roster contests: the same statements for 2 contests as for 20 (#1315)', async () => {
    await expectConstantQueries(projectionCase(liveRosterContest(SelectionType.BUDGET_PICK)));
  });

  it('GET a cup projection over live quick pick roster contests: the same statements for 2 contests as for 20 (#1315)', async () => {
    await expectConstantQueries(projectionCase(liveRosterContest(SelectionType.RANDOM_DRAW)));
  });

  it("GET a cup projection over live pick'em pools: the same statements for 2 contests as for 20 (#1315)", async () => {
    await expectConstantQueries(projectionCase(livePredictionContest(SelectionType.PICK_EM)));
  });

  it('GET a cup projection over live survivor pools: the same statements for 2 contests as for 20 (#1315)', async () => {
    await expectConstantQueries(projectionCase(livePredictionContest(SelectionType.SURVIVOR)));
  });

  it('GET a cup projection over live brackets: the same statements for 2 contests as for 20 (#1315)', async () => {
    await expectConstantQueries(projectionCase(liveBracketContest));
  });
});

describe('live positions read together (#1315)', () => {
  it("gives each contest of a mixed cup the places its own leaderboard gives, a tie included", async () => {
    const seeds = [
      liveRosterContest(SelectionType.TIERED),
      liveRosterContest(SelectionType.TIERED, { tied: true }),
      liveRosterContest(SelectionType.BUDGET_PICK),
      liveRosterContest(SelectionType.RANDOM_DRAW),
      livePredictionContest(SelectionType.PICK_EM),
      livePredictionContest(SelectionType.PICK_EM),
      livePredictionContest(SelectionType.SURVIVOR),
      liveBracketContest,
      liveBracketContest,
    ];
    const seeded = await seedLeagueWithTeams(2);
    const contestIds: string[] = [];
    for (const [index, seed] of seeds.entries()) contestIds.push((await seed(seeded, index)).contestId);
    const [leader, trailer] = seeded.squads.map((squad) => squad.id);
    const contests = createContestService(getPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() });

    const batched = await contests.livePositionsOfMany(contestIds);
    const each = [];
    for (const contestId of contestIds) each.push(await contests.livePositionsOf(contestId));

    expect(contestIds.map((contestId) => batched.get(contestId))).toEqual(each);
    // Not vacuous: the tied contest has both teams 1st, every other the first team 1st and the second 2nd.
    expect(each).toEqual(contestIds.map((_, index) => [
      { squadId: leader, position: 1 },
      { squadId: trailer, position: index === 1 ? 1 : 2 },
    ]));
  });
});
