/**
 * A pick'em contest's weeks and season (#717): each week's submitted entries scored and ranked,
 * frozen when the week settles with its winners, and the season total summed when the last week
 * does. Against the stateful in-memory world, so the tests assert the frozen standings and the
 * leaderboard rows, not the calls.
 *
 * A straight-up pool over two weeks of three games each. Week 1: Alice and Bob each get two right
 * and Cara one; Alice's tiebreaker (40) is closer than Bob's (50) to the Monday game's 41. Week 2:
 * Bob gets all three, Alice two; Cara left it in draft at kickoff, so it scores nothing for her.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  MatchStatus,
  PickEmMode,
  SelectionType,
  SportEventStatus,
  type ContestEntry,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { loadPickEmWeekStandings } from '../../../packages/core-api/src/modules/contests/pick-em-standings';
import { ContestSettlementService } from '../../../packages/core-api/src/modules/contests/contest-settlement-service';
import { ContestOperationError, ContestService } from '../../../packages/core-api/src/modules/contests/service';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeSquaresRepo } from '../../support/repo-fakes';

const T0 = new Date('2026-09-01T00:00:00.000Z');
const WEEK_1 = new Date('2026-09-10T20:00:00.000Z');
const WEEK_2 = new Date('2026-09-17T20:00:00.000Z');
const BEFORE_KICKOFF = new Date('2026-09-10T18:00:00.000Z');
const DURING_WEEK_1 = new Date('2026-09-13T21:00:00.000Z');
const DURING_WEEK_2 = new Date('2026-09-20T21:00:00.000Z');
const WEEK_1_SETTLED = new Date('2026-09-15T04:00:00.000Z');
const WEEK_2_SETTLED = new Date('2026-09-22T04:00:00.000Z');
const HOUR = 60 * 60 * 1000;

type Side = 'home' | 'away';

function setup() {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const week1 = world.addSportEvent({ name: 'Week 1', startDate: WEEK_1 });
  const week2 = world.addSportEvent({ name: 'Week 2', startDate: WEEK_2 });
  const weekGames = (start: Date, sportEventId: string, first: number) =>
    [0, 1, 2].map((index) => games.addGame(sportEventId, first + index, new Date(start.getTime() + index * 24 * HOUR)));
  const week1Games = weekGames(WEEK_1, week1.id, 1);
  const week2Games = weekGames(WEEK_2, week2.id, 4);

  const contest = world.addContest(league.id, {
    name: 'Office pick\'em',
    status: ContestStatus.ACTIVE,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.PICK_EM,
    sportEventIds: [week1.id, week2.id],
  });
  world.addConfiguration(contest.id, {
    selectionType: SelectionType.PICK_EM,
    configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
  });
  const viewer = world.addUser({ email: 'viewer@example.com' });
  world.addMember(league.id, viewer.id);

  const enter = (name: string, weeks: Array<{ sportEventId: string; picks: Array<[SportEventMatch, Side]>; tiebreakerValue?: number; submitted: boolean }>) => {
    const squad = world.addSquad(league.id, `${name}'s Pickers`);
    const entry: ContestEntry = {
      id: `entry-${name.toLowerCase()}`, contestId: contest.id, squadId: squad.id, entryNumber: 1, name,
      events: weeks.map((week): ContestEntry['events'][number] => ({
        sportEventId: week.sportEventId,
        status: week.submitted ? ContestEntryStatus.SUBMITTED : ContestEntryStatus.DRAFT,
        ...(week.tiebreakerValue !== undefined && { tiebreakerValue: week.tiebreakerValue }),
      })),
      createdAt: T0, updatedAt: T0,
    };
    world.entries.set(entry.id, entry);
    for (const week of weeks) {
      for (const [game, side] of week.picks) {
        games.predictions.set(`${entry.id}:${game.id}`, {
          id: `prediction-${entry.id}-${game.id}`, contestEntryId: entry.id, sportEventMatchId: game.id,
          sportEventParticipantId: expectDefined(side === 'home' ? game.homeSportEventParticipantId : game.awaySportEventParticipantId),
          confidence: null, pickedAt: T0, createdAt: T0, updatedAt: T0,
        });
      }
    }
    return entry;
  };
  const [g1, g2, g3] = week1Games.map((each) => expectDefined(each));
  const [g4, g5, g6] = week2Games.map((each) => expectDefined(each));
  enter('Alice', [
    { sportEventId: week1.id, picks: [[g1, 'home'], [g2, 'home'], [g3, 'home']], tiebreakerValue: 40, submitted: true },
    { sportEventId: week2.id, picks: [[g4, 'home'], [g5, 'home'], [g6, 'away']], tiebreakerValue: 30, submitted: true },
  ]);
  enter('Bob', [
    { sportEventId: week1.id, picks: [[g1, 'home'], [g2, 'away'], [g3, 'away']], tiebreakerValue: 50, submitted: true },
    { sportEventId: week2.id, picks: [[g4, 'home'], [g5, 'home'], [g6, 'home']], tiebreakerValue: 30, submitted: true },
  ]);
  enter('Cara', [
    { sportEventId: week1.id, picks: [[g1, 'away'], [g2, 'away'], [g3, 'away']], tiebreakerValue: 41, submitted: true },
    { sportEventId: week2.id, picks: [[g4, 'home'], [g5, 'home'], [g6, 'home']], submitted: false },
  ]);

  let now = DURING_WEEK_1;
  const deps = world.contestServiceDeps({
    predictions: games.predictionRepo(),
    matches: games.matchRepo(),
    eventParticipants: games.fieldService(),
    now: () => now,
  });
  const contestService = new ContestService(deps);
  const settlement = new ContestSettlementService({ ...deps, contests: world.contestRepo(), sportEvents: world.sportEventRepo(), squares: fakeSquaresRepo() });

  const play = (game: SportEventMatch, winner: MatchSide | null, homeScore: number, awayScore: number) => {
    games.putMatches([{ ...expectDefined(games.matches.get(game.id)), status: MatchStatus.COMPLETED, winnerSide: winner, homeScore, awayScore }]);
  };
  const setEventStatus = (sportEventId: string, status: SportEventStatus) => {
    world.sportEvents.set(sportEventId, { ...expectDefined(world.sportEvents.get(sportEventId)), status });
  };
  return {
    world, games, contest, week1, week2, viewer, contestService, settlement,
    week1Games: { g1, g2, g3 },
    week2Games: { g4, g5, g6 },
    setNow: (when: Date) => { now = when; },
    play,
    setEventStatus,
    /** Week 1: home wins game 1 (24-17), away wins game 2, home wins Monday's game 3, 21-20. */
    playWeek1: () => {
      play(g1, MatchSide.HOME, 24, 17);
      play(g2, MatchSide.AWAY, 10, 13);
      play(g3, MatchSide.HOME, 21, 20);
    },
    /** Week 2: home wins every game; Monday's game 6 ends 17-14. */
    playWeek2: () => {
      play(g4, MatchSide.HOME, 27, 3);
      play(g5, MatchSide.HOME, 20, 10);
      play(g6, MatchSide.HOME, 17, 14);
    },
    leaderboard: () => contestService.getPickEmLeaderboard(contest.id, viewer.id),
  };
}

type Context = ReturnType<typeof setup>;

async function settleWeek1(context: Context) {
  context.playWeek1();
  context.setEventStatus(context.week1.id, SportEventStatus.COMPLETED);
  return context.settlement.settleFinishedSportEvent(context.week1.id, { completedAt: WEEK_1_SETTLED });
}

async function settleWeek2(context: Context) {
  context.playWeek2();
  context.setEventStatus(context.week2.id, SportEventStatus.COMPLETED);
  return context.settlement.settleFinishedSportEvent(context.week2.id, { completedAt: WEEK_2_SETTLED });
}

describe('loadPickEmWeekStandings', () => {
  it('scores only the entries that submitted the week, and breaks level points with the tiebreaker closest to the Monday game\'s total', async () => {
    const context = setup();
    context.playWeek1();
    const week = await loadPickEmWeekStandings(context.world.contestServiceDeps({
      predictions: context.games.predictionRepo(),
      matches: context.games.matchRepo(),
    }), context.contest.id, expectDefined(context.world.sportEvents.get(context.week1.id)), { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false });

    expect(week).toMatchObject({ gameCount: 3, tiebreakerTotalPoints: 41, eventCancelled: false });
    expect(week.entries.map((standing) => [standing.entry.name, standing.score.points, standing.tiebreakerValue, standing.displayPosition])).toEqual([
      ['Alice', 2, 40, '1'],
      ['Bob', 2, 50, '2'],
      ['Cara', 1, 41, '3'],
    ]);
  });
});

describe('ContestSettlementService — a pick\'em week', () => {
  it('freezes each submitted entry\'s points and place for the week, and leaves the contest ACTIVE while a week is still to play', async () => {
    const context = setup();
    const summary = await settleWeek1(context);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 0, standingsUpserted: 0 });
    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    expect(frozen.map((standing) => [standing.contestEntryId, standing.sportEventId, standing.totalScore, standing.displayPosition, standing.countingPickLimit, standing.scoredPickCount]))
      .toEqual(expect.arrayContaining([
        ['entry-alice', context.week1.id, 2, '1', 3, 3],
        ['entry-bob', context.week1.id, 2, '2', 3, 3],
        ['entry-cara', context.week1.id, 1, '3', 3, 3],
      ]));
    expect(frozen).toHaveLength(3);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.ACTIVE);
  });

  it('keeps a settled week as it was frozen when a result is corrected and the week settles again', async () => {
    const context = setup();
    await settleWeek1(context);
    context.play(context.week1Games.g2, MatchSide.HOME, 13, 10);
    await context.settlement.settleFinishedSportEvent(context.week1.id, { completedAt: WEEK_1_SETTLED });

    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    expect(frozen.find((standing) => standing.contestEntryId === 'entry-bob')?.totalScore).toBe(2);
  });

  it('sums every week into the season total when the last week settles, ranks it and completes the contest', async () => {
    const context = setup();
    await settleWeek1(context);
    const summary = await settleWeek2(context);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 3 });
    const season = await context.world.standingRepo().findByContest(context.contest.id);
    expect(season.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition, standing.countingPickLimit]))
      .toEqual(expect.arrayContaining([
        ['entry-bob', 5, '1', 6],
        ['entry-alice', 4, '2', 6],
        ['entry-cara', 1, '3', 6],
      ]));
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
  });

  it('counts a cancelled week for nothing: it writes no week standings, and the season sums the weeks played', async () => {
    const context = setup();
    await settleWeek1(context);
    context.setEventStatus(context.week2.id, SportEventStatus.CANCELLED);
    await context.settlement.settleFinishedSportEvent(context.week2.id, { completedAt: WEEK_2_SETTLED });

    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    expect(frozen.every((standing) => standing.sportEventId === context.week1.id)).toBe(true);
    const season = await context.world.standingRepo().findByContest(context.contest.id);
    // The season ranks by total alone: Alice and Bob, level on week 1's points, share first place.
    expect(season.find((standing) => standing.contestEntryId === 'entry-alice')).toMatchObject({ totalScore: 2, displayPosition: 'T1', countingPickLimit: 3 });
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
  });
});

describe('ContestService.getPickEmLeaderboard', () => {
  it('shows no points for a week that has not started, and every entry unranked', async () => {
    const context = setup();
    context.setNow(BEFORE_KICKOFF);
    context.world.contests.set(context.contest.id, { ...context.contest, status: ContestStatus.OPEN });

    const leaderboard = await context.leaderboard();
    expect(leaderboard.weeks.map((week) => [week.name, week.started, week.settled])).toEqual([['Week 1', false, false], ['Week 2', false, false]]);
    expect(leaderboard.entries.every((entry) => entry.position === null && entry.totalPoints === 0)).toBe(true);
    expect(leaderboard.entries.flatMap((entry) => entry.weeks.map((week) => week.points))).toEqual([null, null, null, null, null, null]);
  });

  it('scores a week under way live from its played games, with no winner until it settles', async () => {
    const context = setup();
    context.play(context.week1Games.g1, MatchSide.HOME, 24, 17);

    const leaderboard = await context.leaderboard();
    expect(leaderboard.weeks[0]).toMatchObject({ started: true, settled: false, winnerEntryIds: [], tiebreakerTotalPoints: null });
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.totalPoints, entry.displayPosition, entry.weeks[0]?.points, entry.weeks[0]?.weeklyWinner]))
      .toEqual([
        ['Alice', 1, 'T1', 1, false],
        ['Bob', 1, 'T1', 1, false],
        ['Cara', 0, '3', 0, false],
      ]);
  });

  it('marks a settled week\'s winner and adds the next week live to the season total', async () => {
    const context = setup();
    await settleWeek1(context);
    context.setNow(DURING_WEEK_2);
    context.play(context.week2Games.g4, MatchSide.HOME, 27, 3);

    const leaderboard = await context.leaderboard();
    expect(leaderboard.weeks.map((week) => [week.name, week.settled, week.winnerEntryIds])).toEqual([
      ['Week 1', true, ['entry-alice']],
      ['Week 2', false, []],
    ]);
    expect(leaderboard.entries.map((entry) => [
      entry.entryName, entry.totalPoints, entry.displayPosition,
      entry.weeks.map((week) => [week.submitted, week.points, week.displayPosition, week.weeklyWinner]),
    ])).toEqual([
      ['Alice', 3, 'T1', [[true, 2, '1', true], [true, 1, 'T1', false]]],
      ['Bob', 3, 'T1', [[true, 2, '2', false], [true, 1, 'T1', false]]],
      // Cara left week 2 in draft, so it scores nothing for her.
      ['Cara', 1, '3', [[true, 1, '3', false], [false, null, null, false]]],
    ]);
  });

  it('answers a COMPLETED contest from its frozen standings, so a later result correction changes no total or place', async () => {
    const context = setup();
    await settleWeek1(context);
    await settleWeek2(context);
    context.play(context.week2Games.g6, MatchSide.AWAY, 14, 17);

    const leaderboard = await context.leaderboard();
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.totalPoints, entry.displayPosition])).toEqual([
      ['Bob', 5, '1'],
      ['Alice', 4, '2'],
      ['Cara', 1, '3'],
    ]);
    expect(leaderboard.weeks.map((week) => week.winnerEntryIds)).toEqual([['entry-alice'], ['entry-bob']]);
  });

  it('reads a completed week that no entry submitted as settled, since it has nothing to freeze', async () => {
    const context = setup();
    await settleWeek1(context);
    for (const entry of context.world.entries.values()) {
      context.world.entries.set(entry.id, {
        ...entry,
        events: entry.events.map((event) => event.sportEventId === context.week2.id ? { ...event, status: ContestEntryStatus.DRAFT } : event),
      });
    }
    await settleWeek2(context);

    const leaderboard = await context.leaderboard();
    expect(leaderboard.weeks.map((week) => [week.name, week.settled, week.winnerEntryIds])).toEqual([
      ['Week 1', true, ['entry-alice']],
      ['Week 2', true, []],
    ]);
  });

  it('reads a cancelled week as settled, with no points for any entry', async () => {
    const context = setup();
    await settleWeek1(context);
    context.setEventStatus(context.week2.id, SportEventStatus.CANCELLED);
    await context.settlement.settleFinishedSportEvent(context.week2.id, { completedAt: WEEK_2_SETTLED });

    const leaderboard = await context.leaderboard();
    expect(leaderboard.weeks[1]).toMatchObject({ settled: true, winnerEntryIds: [] });
    expect(leaderboard.entries.map((entry) => entry.weeks[1]?.points)).toEqual([null, null, null]);
  });

  it('refuses a contest that is not pick\'em with CONTEST_FORMAT_MISMATCH', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contest, selectionType: SelectionType.BRACKET });

    const error = await context.leaderboard().then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContestOperationError);
    expect(error).toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
  });
});
