/**
 * Playoff survivor (#785): a survivor contest on one playoff bracket, each round a week of its
 * own. The entry submits the event once with its first round's pick, then holds one pick in each
 * later round; a team picked in one round is used for the rest, and a round that starts with no
 * pick puts the entry out, which is what running out of unused teams comes to.
 *
 * Eight teams, three rounds, every result going to the home team except the final:
 * - Round 1: T1 beats T2, T3 beats T4, T5 beats T6, T7 beats T8.
 * - Round 2: T1 beats T3, T5 beats T7.
 * - Final: T5 beats T1 (the away team).
 *
 * Alice picks T3, T1 and T5: still in at the end. Bob picks T1 and T5, then has no unused team in
 * the final: out in round 3. Dan picks T7 and leaves round 2 without a pick: out in round 2. Cara
 * picks T2: out in round 1.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  MatchStatus,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  SurvivorWeekOutcome,
  type ContestEntry,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { ContestSettlementService } from '../../../packages/core-api/src/modules/contests/contest-settlement-service';
import { ContestService } from '../../../packages/core-api/src/modules/contests/service';
import { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeSquaresRepo } from '../../support/repo-fakes';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date('2027-01-01T00:00:00.000Z');
const ROUND_1 = new Date('2027-01-09T20:00:00.000Z');
const ROUND_2 = new Date(ROUND_1.getTime() + 7 * DAY);
const FINAL = new Date(ROUND_1.getTime() + 14 * DAY);
const later = (when: Date, hours: number) => new Date(when.getTime() + hours * HOUR);

type Team = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';
type Name = 'Alice' | 'Bob' | 'Cara' | 'Dan';

/** `untimedLaterRounds`: the later rounds' games have no time yet, as before their round is set. */
function setup(options: { untimedLaterRounds?: boolean } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const playoffs = world.addSportEvent({ name: 'Playoffs', startDate: ROUND_1, rounds: 3 });

  const round1 = [1, 2, 3, 4].map((matchNumber) => games.addGame(playoffs.id, matchNumber, later(ROUND_1, matchNumber - 1)));
  const teamRow = {} as Record<Team, string>;
  round1.forEach((game, index) => {
    teamRow[`T${index * 2 + 1}` as Team] = expectDefined(game.homeSportEventParticipantId ?? undefined);
    teamRow[`T${index * 2 + 2}` as Team] = expectDefined(game.awaySportEventParticipantId ?? undefined);
  });
  /** A later-round game, its teams not yet known. */
  const laterGame = (matchNumber: number, roundNumber: number, kickoff: Date): SportEventMatch => ({
    ...round1[0],
    id: `game-${matchNumber}`,
    matchNumber,
    roundNumber,
    scheduledDate: options.untimedLaterRounds === true ? null : kickoff,
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
  });
  const g5 = laterGame(5, 2, ROUND_2);
  const g6 = laterGame(6, 2, later(ROUND_2, 1));
  const g7 = laterGame(7, 3, FINAL);
  games.putMatches([g5, g6, g7]);

  const contest = world.addContest(league.id, {
    name: 'Playoff survivor',
    status: ContestStatus.OPEN,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.SURVIVOR,
    sportEventIds: [playoffs.id],
  });
  world.addConfiguration(contest.id, {
    selectionType: SelectionType.SURVIVOR,
    configJson: { selectionType: SelectionType.SURVIVOR },
  });

  const users = new Map<Name, string>();
  for (const name of ['Alice', 'Bob', 'Cara', 'Dan'] as const) {
    const user = world.addUser({ email: `${name.toLowerCase()}@example.com` });
    world.addMember(league.id, user.id);
    const squad = world.addSquad(league.id, `${name}'s Survivors`);
    world.addSquadMember(squad.id, user.id);
    users.set(name, user.id);
    const entry: ContestEntry = {
      id: `entry-${name.toLowerCase()}`, contestId: contest.id, squadId: squad.id, entryNumber: 1, name,
      events: [{ sportEventId: playoffs.id, status: ContestEntryStatus.DRAFT }],
      createdAt: T0, updatedAt: T0,
    };
    world.entries.set(entry.id, entry);
  }

  let now = later(ROUND_1, -2);
  const deps = world.contestServiceDeps({
    predictions: games.predictionRepo(),
    matches: games.matchRepo(),
    participants: games.participantRepo(),
    eventParticipants: games.fieldService(),
    now: () => now,
  });
  const contestService = new ContestService(deps);
  const settlement = new ContestSettlementService({ ...deps, contests: world.contestRepo(), sportEvents: world.sportEventRepo(), squares: fakeSquaresRepo() });
  const predictions = new PredictionService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    scoringRules: world.scoringRuleRepo(),
    entries: world.entryRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: world.sportEventRepo(),
    matches: games.matchRepo(),
    field: games.fieldRepo(),
    participants: games.participantRepo(),
    predictions: games.predictionRepo(),
    now: () => now,
  });

  const input = (name: Name) => ({
    contestId: contest.id,
    entryId: `entry-${name.toLowerCase()}`,
    sportEventId: playoffs.id,
    actorUserId: expectDefined(users.get(name)),
  });
  const game = (matchNumber: number) => expectDefined(games.matches.get(`game-${matchNumber}`));
  const pick = (matchNumber: number, team: Team) => ({ sportEventMatchId: `game-${matchNumber}`, predictedResult: PredictedResult.TEAM, sportEventParticipantId: teamRow[team], confidence: null });
  const save = (name: Name, matchNumber: number, team: Team) => predictions.saveGamePicks({ ...input(name), picks: [pick(matchNumber, team)] });
  /** The game is played: `winner` wins it. */
  const play = (matchNumber: number, winner: MatchSide) => {
    games.putMatches([{ ...game(matchNumber), status: MatchStatus.COMPLETED, winnerSide: winner, homeScore: winner === MatchSide.HOME ? 24 : 10, awayScore: winner === MatchSide.HOME ? 10 : 24 }]);
  };
  /** The admin places the round's teams once the round before is played. */
  const place = (matchNumber: number, home: Team, away: Team) => {
    games.putMatches([{ ...game(matchNumber), homeSportEventParticipantId: teamRow[home], awaySportEventParticipantId: teamRow[away] }]);
  };
  const storedPicks = (name: Name) => [...games.predictions.values()]
    .filter((row) => row.contestEntryId === `entry-${name.toLowerCase()}`)
    .map((row) => row.sportEventMatchId)
    .sort();

  return {
    world, contest, playoffs, contestService, settlement, predictions, input, pick, save, play, place, storedPicks,
    setNow: (when: Date) => { now = when; },
    leaderboard: () => contestService.getSurvivorLeaderboard(contest.id, expectDefined(users.get('Alice'))),
    /** Round 1 picked and submitted as the file comment tells it, and played. */
    async playRound1() {
      await save('Alice', 2, 'T3');
      await save('Bob', 1, 'T1');
      await save('Cara', 1, 'T2');
      await save('Dan', 4, 'T7');
      for (const name of ['Alice', 'Bob', 'Cara', 'Dan'] as const) await predictions.submitGamePicks(input(name));
      world.contests.set(contest.id, { ...contest, status: ContestStatus.ACTIVE });
      world.sportEvents.set(playoffs.id, { ...playoffs, status: SportEventStatus.IN_PROGRESS });
      now = later(ROUND_1, 6);
      for (const matchNumber of [1, 2, 3, 4]) play(matchNumber, MatchSide.HOME);
      place(5, 'T1', 'T3');
      place(6, 'T5', 'T7');
      now = later(ROUND_2, -2);
    },
  };
}

type Context = ReturnType<typeof setup>;

async function expectRefused(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SelectionError);
  expect(error).toMatchObject({ code, statusCode });
}

/** Rounds 2 and 3 picked and played as the file comment tells them; the playoffs complete. */
async function playOut(context: Context) {
  await context.save('Alice', 5, 'T1');
  await context.save('Bob', 6, 'T5');
  context.setNow(later(ROUND_2, 6));
  context.play(5, MatchSide.HOME);
  context.play(6, MatchSide.HOME);
  context.place(7, 'T1', 'T5');
  context.setNow(later(FINAL, -2));
  await context.save('Alice', 7, 'T5');
  context.setNow(later(FINAL, 6));
  context.play(7, MatchSide.AWAY);
}

describe('PredictionService — a playoff survivor pool, each round a week', () => {
  it('submits the playoffs with one first-round pick, and refuses a submit with none', async () => {
    const context = setup();
    await expectRefused(context.predictions.submitGamePicks(context.input('Alice')), 'PREDICTION_ONE_PICK_REQUIRED', 409);
    await context.save('Alice', 2, 'T3');
    const submitted = await context.predictions.submitGamePicks(context.input('Alice'));
    expect(submitted.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses a later round\'s pick before that round\'s teams are placed', async () => {
    const context = setup();
    await expectRefused(context.save('Alice', 5, 'T1'), 'PREDICTION_TEAM_NOT_IN_GAME', 400);
  });

  it('keeps the first round\'s pick when a later round is picked, and replaces only the pick in the same round', async () => {
    const context = setup();
    await context.playRound1();
    await context.save('Alice', 5, 'T1');
    const view = await context.save('Alice', 6, 'T7');
    expect(context.storedPicks('Alice')).toEqual(['game-2', 'game-6']);
    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses two picks in one round in a single save', async () => {
    const context = setup();
    await context.playRound1();
    await expectRefused(
      context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pick(5, 'T1'), context.pick(6, 'T5')] }),
      'PREDICTION_ONE_PICK_REQUIRED',
      409,
    );
  });

  it('refuses a team the entry picked in an earlier round', async () => {
    const context = setup();
    await context.playRound1();
    await expectRefused(context.save('Alice', 5, 'T3'), 'PREDICTION_TEAM_ALREADY_USED', 409);
    expect(context.storedPicks('Alice')).toEqual(['game-2']);
  });

  it('refuses every later pick of an entry its first-round team put out, and shows it the round it went out in', async () => {
    const context = setup();
    await context.playRound1();
    await expectRefused(context.save('Cara', 5, 'T1'), 'PREDICTION_ENTRY_ELIMINATED', 409);
    const view = await context.predictions.getGamePicks(context.input('Cara'));
    expect(view.survivor?.eliminatedInWeek).toBe(1);
  });
});

describe('Playoff survivor rounds whose games have no time yet', () => {
  it('keeps a later round open while its games have no time: no entry goes out at the playoffs\' start, and the round takes its pick once its teams are placed', async () => {
    const context = setup({ untimedLaterRounds: true });
    await context.playRound1();

    const view = await context.save('Alice', 5, 'T1');
    expect(view.games.filter((game) => game.match.roundNumber === 2).map((game) => game.locked)).toEqual([false, false]);
    expect(context.storedPicks('Alice')).toEqual(['game-2', 'game-5']);
    const rows = Object.fromEntries((await context.leaderboard()).entries.map((entry) => [entry.entryName, [entry.alive, entry.eliminatedInWeek]]));
    expect(rows).toEqual({ Alice: [true, null], Bob: [true, null], Dan: [true, null], Cara: [false, 1] });
  });
});

describe('Playoff survivor leaderboard and settlement', () => {
  it('shows a week per round, and ranks entries by rounds survived: a round started with no pick, even for want of an unused team, puts the entry out', async () => {
    const context = setup();
    await context.playRound1();
    await playOut(context);
    const board = await context.leaderboard();

    expect(board.weeks.map((week) => [week.weekNumber, week.roundNumber, week.roundCount])).toEqual([[1, 1, 3], [2, 2, 3], [3, 3, 3]]);
    expect(board.weeks.map((week) => week.aliveCount)).toEqual([3, 2, 1]);
    const rows = Object.fromEntries(board.entries.map((entry) => [entry.entryName, entry]));
    expect(Object.fromEntries(Object.entries(rows).map(([name, entry]) => [name, [entry.alive, entry.eliminatedInWeek, entry.weeksSurvived, entry.displayPosition]])))
      .toEqual({
        Alice: [true, null, 3, '1'],
        Bob: [false, 3, 2, '2'],
        Dan: [false, 2, 1, '3'],
        Cara: [false, 1, 0, '4'],
      });
    expect(expectDefined(rows['Bob']).weeks.map((week) => [week.roundNumber, week.outcome])).toEqual([
      [1, SurvivorWeekOutcome.SURVIVED],
      [2, SurvivorWeekOutcome.SURVIVED],
      [3, SurvivorWeekOutcome.ELIMINATED],
    ]);
  });

  it('settles the playoffs with each entry\'s rounds survived and completes the contest', async () => {
    const context = setup();
    await context.playRound1();
    await playOut(context);
    context.world.sportEvents.set(context.playoffs.id, { ...context.playoffs, status: SportEventStatus.COMPLETED });
    await context.settlement.settleFinishedSportEvent(context.playoffs.id, { completedAt: later(FINAL, 8) });

    const eventStandings = [...context.world.eventStandings.values()];
    expect(Object.fromEntries(eventStandings.map((row) => [row.contestEntryId, [row.totalScore, row.displayPosition]]))).toEqual({
      'entry-alice': [3, '1'],
      'entry-bob': [2, '2'],
      'entry-dan': [1, '3'],
      'entry-cara': [0, '4'],
    });
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
  });
});
