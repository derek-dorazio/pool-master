/**
 * Survivor (#719): one team a week, each team once, out after a loss, a tie or a week not
 * submitted. The season rules (`survivorRun`), the engine, picking a week, the leaderboard and
 * settlement, against the stateful in-memory world, so the tests assert stored picks, frozen
 * standings and leaderboard rows rather than calls.
 *
 * Three weeks of two games, four teams. Week 1: the Bills beat the Jets, the Chiefs beat the
 * Raiders. Week 2: the Bills beat the Jets again, the Chiefs beat the Raiders. Week 3: Bills v
 * Raiders is cancelled, the Chiefs beat the Jets.
 * - Alice picks the Bills, then the Chiefs, then the Raiders: still in at the end.
 * - Bob picks the Chiefs, then the Jets: out in week 2.
 * - Cara picks the Jets: out in week 1.
 * - Dan picks the Bills, then leaves week 2 in draft: out in week 2.
 */
import { expect } from '@jest/globals';
import {
  MatchEnding,
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
import { ContestOperationError, ContestService } from '../../../packages/core-api/src/modules/contests/service';
import { survivorPickOutcome, survivorRun, survivorTeamsUsedInCycle, type SurvivorWeek } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/survivor';
import { PredictionIssueKind } from '../../../packages/core-api/src/modules/selections/prediction-engines/prediction-engine';
import { survivorPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/survivor';
import { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeSquaresRepo } from '../../support/repo-fakes';

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-09-01T00:00:00.000Z');
const WEEK_1 = new Date('2026-09-10T20:00:00.000Z');
const WEEK_2 = new Date('2026-09-17T20:00:00.000Z');
const WEEK_3 = new Date('2026-09-24T20:00:00.000Z');
const later = (when: Date, hours: number) => new Date(when.getTime() + hours * HOUR);

type TeamName = 'Bills' | 'Jets' | 'Chiefs' | 'Raiders';

function setup(rules: { reuseTeamsOnceAllUsed?: boolean } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const week1 = world.addSportEvent({ name: 'Week 1', startDate: WEEK_1 });
  const week2 = world.addSportEvent({ name: 'Week 2', startDate: WEEK_2 });
  const week3 = world.addSportEvent({ name: 'Week 3', startDate: WEEK_3 });

  // Week 1 brings the four teams; the later weeks put the same teams in their fields.
  const g1 = games.addGame(week1.id, 1, WEEK_1);
  const g2 = games.addGame(week1.id, 2, later(WEEK_1, 24));
  const participantOf = (game: SportEventMatch, side: 'home' | 'away') =>
    expectDefined(games.field.get(expectDefined(side === 'home' ? game.homeSportEventParticipantId : game.awaySportEventParticipantId))).participantId;
  const team: Record<TeamName, string> = {
    Bills: participantOf(g1, 'home'),
    Jets: participantOf(g1, 'away'),
    Chiefs: participantOf(g2, 'home'),
    Raiders: participantOf(g2, 'away'),
  };
  for (const [name, participantId] of Object.entries(team)) {
    games.participants.set(participantId, { ...expectDefined(games.participants.get(participantId)), name });
  }
  const g3 = games.addGame(week2.id, 3, WEEK_2, MatchStatus.SCHEDULED, { home: team.Bills, away: team.Jets });
  const g4 = games.addGame(week2.id, 4, later(WEEK_2, 24), MatchStatus.SCHEDULED, { home: team.Chiefs, away: team.Raiders });
  const g5 = games.addGame(week3.id, 5, WEEK_3, MatchStatus.SCHEDULED, { home: team.Bills, away: team.Raiders });
  const g6 = games.addGame(week3.id, 6, later(WEEK_3, 24), MatchStatus.SCHEDULED, { home: team.Chiefs, away: team.Jets });

  const contest = world.addContest(league.id, {
    name: 'Office survivor',
    status: ContestStatus.ACTIVE,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.SURVIVOR,
    sportEventIds: [week1.id, week2.id, week3.id],
  });
  world.addConfiguration(contest.id, {
    selectionType: SelectionType.SURVIVOR,
    configJson: { selectionType: SelectionType.SURVIVOR, ...rules },
  });

  /** The field row the team plays the game from. */
  const sideOf = (game: SportEventMatch, name: TeamName) => {
    const row = [game.homeSportEventParticipantId, game.awaySportEventParticipantId]
      .find((id) => id !== null && games.field.get(id)?.participantId === team[name]);
    return expectDefined(row ?? undefined);
  };
  const users = new Map<string, string>();
  const enter = (name: string, weeks: Array<{ sportEventId: string; pick: [SportEventMatch, TeamName] | null; submitted: boolean }>) => {
    const user = world.addUser({ email: `${name.toLowerCase()}@example.com` });
    world.addMember(league.id, user.id);
    const squad = world.addSquad(league.id, `${name}'s Survivors`);
    world.addSquadMember(squad.id, user.id);
    users.set(name, user.id);
    const entry: ContestEntry = {
      id: `entry-${name.toLowerCase()}`, contestId: contest.id, squadId: squad.id, entryNumber: 1, name,
      events: [week1, week2, week3].map((week): ContestEntry['events'][number] => ({
        sportEventId: week.id,
        status: weeks.find((each) => each.sportEventId === week.id)?.submitted === true ? ContestEntryStatus.SUBMITTED : ContestEntryStatus.DRAFT,
      })),
      createdAt: T0, updatedAt: T0,
    };
    world.entries.set(entry.id, entry);
    for (const week of weeks) {
      if (!week.pick) continue;
      const [game, picked] = week.pick;
      games.predictions.set(`${entry.id}:${game.id}`, {
        id: `prediction-${entry.id}-${game.id}`, contestEntryId: entry.id, sportEventMatchId: game.id,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: sideOf(game, picked), confidence: null, pickedAt: T0, createdAt: T0, updatedAt: T0,
      });
    }
    return entry;
  };
  enter('Alice', [
    { sportEventId: week1.id, pick: [g1, 'Bills'], submitted: true },
    { sportEventId: week2.id, pick: [g4, 'Chiefs'], submitted: true },
  ]);
  enter('Bob', [
    { sportEventId: week1.id, pick: [g2, 'Chiefs'], submitted: true },
    { sportEventId: week2.id, pick: [g3, 'Jets'], submitted: true },
  ]);
  enter('Cara', [{ sportEventId: week1.id, pick: [g1, 'Jets'], submitted: true }]);
  enter('Dan', [
    { sportEventId: week1.id, pick: [g1, 'Bills'], submitted: true },
    { sportEventId: week2.id, pick: [g4, 'Raiders'], submitted: false },
  ]);

  let now = later(WEEK_1, -2);
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

  const play = (game: SportEventMatch, winner: MatchSide | null) => {
    games.putMatches([{ ...expectDefined(games.matches.get(game.id)), status: MatchStatus.COMPLETED, winnerSide: winner, homeScore: 20, awayScore: winner === null ? 20 : 10 }]);
  };
  const cancel = (game: SportEventMatch) => {
    games.putMatches([{ ...expectDefined(games.matches.get(game.id)), status: MatchStatus.CANCELLED }]);
  };
  const setEventStatus = (sportEventId: string, status: SportEventStatus) => {
    world.sportEvents.set(sportEventId, { ...expectDefined(world.sportEvents.get(sportEventId)), status });
  };
  const viewerId = expectDefined(users.get('Alice'));
  return {
    world, games, contest, week1, week2, week3, team, contestService, settlement, predictions,
    gamesByNumber: { g1, g2, g3, g4, g5, g6 },
    sideOf, play, cancel, setEventStatus,
    userOf: (name: string) => expectDefined(users.get(name)),
    setNow: (when: Date) => { now = when; },
    /** Each week's results as the file comment tells them. */
    playWeek1: () => { play(g1, MatchSide.HOME); play(g2, MatchSide.HOME); },
    playWeek2: () => { play(g3, MatchSide.HOME); play(g4, MatchSide.HOME); },
    playWeek3: () => { cancel(g5); play(g6, MatchSide.HOME); },
    leaderboard: () => contestService.getSurvivorLeaderboard(contest.id, viewerId),
    storedPicks: (entryId: string) => [...games.predictions.values()]
      .filter((row) => row.contestEntryId === entryId)
      .map((row) => row.sportEventMatchId)
      .sort(),
  };
}

type Context = ReturnType<typeof setup>;

async function expectRefused(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SelectionError);
  expect(error).toMatchObject({ code, statusCode });
}

async function settle(context: Context, sportEventId: string, completedAt: Date) {
  context.setEventStatus(sportEventId, SportEventStatus.COMPLETED);
  return context.settlement.settleFinishedSportEvent(sportEventId, { completedAt });
}

function survivorWeek(overrides: Partial<SurvivorWeek> & Pick<SurvivorWeek, 'sportEventId'>): SurvivorWeek {
  return { roundNumber: 1, started: true, cancelled: false, submitted: true, games: [], pick: null, pickedParticipantId: null, ...overrides };
}

function game(id: string, overrides: Partial<SportEventMatch> = {}): SportEventMatch {
  return {
    id, sportEventId: 'week', roundNumber: 1, matchNumber: 1,
    homeSportEventParticipantId: `${id}-home`, awaySportEventParticipantId: `${id}-away`,
    isNeutralSite: false, scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null,
    homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED, advancesToMatchId: null, advancesToSide: null, regionLabel: null, homeSpread: null, periodScores: [],
    createdAt: T0, updatedAt: T0, ...overrides,
  };
}

describe('survivorPickOutcome', () => {
  const pick = { sportEventMatchId: 'g', sportEventParticipantId: 'g-home' };

  it('survives when the picked team wins, and is out when it loses or ties', () => {
    expect(survivorPickOutcome([game('g', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME })], pick)).toBe(SurvivorWeekOutcome.SURVIVED);
    expect(survivorPickOutcome([game('g', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY })], pick)).toBe(SurvivorWeekOutcome.ELIMINATED);
    expect(survivorPickOutcome([game('g', { status: MatchStatus.COMPLETED, winnerSide: null })], pick)).toBe(SurvivorWeekOutcome.ELIMINATED);
  });

  it('survives a cancelled game, and stays pending while the game is unplayed', () => {
    expect(survivorPickOutcome([game('g', { status: MatchStatus.CANCELLED })], pick)).toBe(SurvivorWeekOutcome.SURVIVED);
    expect(survivorPickOutcome([game('g', { status: MatchStatus.IN_PROGRESS })], pick)).toBe(SurvivorWeekOutcome.PENDING);
  });
});

describe('survivorRun', () => {
  const won = game('w', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME });
  const lost = game('l', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY });
  const winning = { games: [won], pick: { sportEventMatchId: 'w', sportEventParticipantId: 'w-home' } };
  const losing = { games: [lost], pick: { sportEventMatchId: 'l', sportEventParticipantId: 'l-home' } };

  it('counts the weeks survived, puts the entry out at its first loss, and plays no week after it', () => {
    const run = survivorRun([
      survivorWeek({ sportEventId: 'w1', ...winning, pickedParticipantId: 'bills' }),
      survivorWeek({ sportEventId: 'w2', ...losing, pickedParticipantId: 'jets' }),
      survivorWeek({ sportEventId: 'w3', ...winning, pickedParticipantId: 'chiefs' }),
    ]);
    expect(run.weeks.map((week) => week.outcome)).toEqual([SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.ELIMINATED, null]);
    expect(run).toMatchObject({ eliminatedAt: 1, weeksSurvived: 1 });
    expect([...run.usedParticipantIds]).toEqual(['bills', 'jets']);
  });

  it('puts the entry out in a started week it did not submit, but not in one not yet started', () => {
    expect(survivorRun([survivorWeek({ sportEventId: 'w1', ...winning, submitted: false })]).eliminatedAt).toBe(0);
    const ahead = survivorRun([survivorWeek({ sportEventId: 'w1', started: false, submitted: false, pick: null })]);
    expect(ahead).toMatchObject({ eliminatedAt: null, weeksSurvived: 0 });
    expect(ahead.weeks[0]?.outcome).toBeNull();
  });

  it('lets a cancelled week count for nothing: no one goes out for it and it uses up no team', () => {
    const run = survivorRun([
      survivorWeek({ sportEventId: 'w1', cancelled: true, submitted: false, pickedParticipantId: 'bills' }),
      survivorWeek({ sportEventId: 'w2', ...winning, pickedParticipantId: 'chiefs' }),
    ]);
    expect(run.weeks.map((week) => week.outcome)).toEqual([null, SurvivorWeekOutcome.SURVIVED]);
    expect(run).toMatchObject({ eliminatedAt: null, weeksSurvived: 1 });
    expect([...run.usedParticipantIds]).toEqual(['chiefs']);
  });
});

describe('survivorTeamsUsedInCycle', () => {
  it('counts every other week\'s pick when each team is used once all season', () => {
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', null, 'd'], 3, null)]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a new cycle once the entry has used every team, so the first cycle\'s teams can be picked again', () => {
    // Three teams: weeks 1-3 use all of them, so week 4 starts the second cycle.
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', null], 3, 3)]).toEqual([]);
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', 'a', null], 4, 3)]).toEqual(['a']);
  });

  it('keeps the week in its own cycle, counting a pick made ahead in a later week of that cycle', () => {
    expect([...survivorTeamsUsedInCycle(['a', null, 'b'], 1, 3)]).toEqual(['a', 'b']);
    // Week 2 closes the first cycle, so week 4's pick ahead belongs to the second one.
    expect([...survivorTeamsUsedInCycle(['a', 'b', null, 'c'], 1, 2)]).toEqual(['a']);
  });

  it('skips weeks with no counted pick, so a cycle closes only on teams actually used', () => {
    expect([...survivorTeamsUsedInCycle(['a', null, 'b', null], 3, 3)]).toEqual(['a', 'b']);
  });
});

describe('survivorPredictionEngine', () => {
  const games = [game('a'), game('b')];

  it('keeps the latest pick of the week and clears the other, as a new pick replaces the entry\'s one', () => {
    const first = { sportEventMatchId: 'a', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'a-home', confidence: null };
    const second = { sportEventMatchId: 'b', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'b-away', confidence: null };
    const resolved = survivorPredictionEngine.resolvePicks({ games, predictions: [first, second], seedOf: new Map() });
    expect(resolved.kept).toEqual([second]);
    expect(resolved.stranded).toEqual([first]);
  });

  it('refuses a week with no pick or two, a team used in another week, and any week of an entry that is out', () => {
    // The week under test is week 3 of the contest, one round of games a and b.
    const season = {
      usedParticipantIds: new Set(['bills']),
      eliminatedInWeek: null,
      participantIdOf: new Map([['a-home', 'bills'], ['b-home', 'chiefs']]),
      roundOf: new Map([['a', 1], ['b', 1]]),
      firstRoundNumber: 1,
      weekNumberOfRound: new Map([[1, 3]]),
      firstWeekNumber: 3,
    };
    const issues = (predictions: Array<{ sportEventMatchId: string; predictedResult: typeof PredictedResult.TEAM; sportEventParticipantId: string }>, eliminatedInWeek: number | null = null) =>
      survivorPredictionEngine.findWeekIssues({
        configuration: { selectionType: SelectionType.SURVIVOR },
        gameMatchIds: ['a', 'b'],
        predictions: predictions.map((prediction) => ({ ...prediction, confidence: null })),
        tiebreakerValue: null,
        season: { ...season, eliminatedInWeek },
      }).map((issue) => issue.kind);

    expect(issues([{ sportEventMatchId: 'b', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'b-home' }])).toEqual([]);
    expect(issues([])).toEqual([PredictionIssueKind.ONE_PICK_REQUIRED]);
    expect(issues([{ sportEventMatchId: 'a', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'a-home' }, { sportEventMatchId: 'b', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'b-home' }]))
      .toEqual([PredictionIssueKind.ONE_PICK_REQUIRED, PredictionIssueKind.TEAM_ALREADY_USED]);
    expect(issues([{ sportEventMatchId: 'a', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'a-home' }])).toEqual([PredictionIssueKind.TEAM_ALREADY_USED]);
    expect(issues([{ sportEventMatchId: 'b', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'b-home' }], 2)).toEqual([PredictionIssueKind.ENTRY_ELIMINATED]);
  });

  it('takes no confidence value and has no tiebreaker game', () => {
    expect(survivorPredictionEngine.acceptsConfidence({ configuration: undefined, confidence: 1, gameCount: 2 })).toBe(false);
    expect(survivorPredictionEngine.tiebreakerGame({ games, eventStart: T0 })).toBeNull();
  });
});

describe('PredictionService — a survivor week', () => {
  /** Weeks 1 and 2 played; week 3 two hours from its first kickoff. */
  function beforeWeek3(rules: { reuseTeamsOnceAllUsed?: boolean } = {}) {
    const context = setup(rules);
    context.playWeek1();
    context.playWeek2();
    context.setEventStatus(context.week1.id, SportEventStatus.COMPLETED);
    context.setEventStatus(context.week2.id, SportEventStatus.COMPLETED);
    context.setNow(later(WEEK_3, -2));
    const input = (name: string) => ({
      contestId: context.contest.id,
      entryId: `entry-${name.toLowerCase()}`,
      sportEventId: context.week3.id,
      actorUserId: context.userOf(name),
    });
    const pickOf = (game: SportEventMatch, name: TeamName) => ({ sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: context.sideOf(game, name), confidence: null });
    return { ...context, input, pickOf };
  }

  it('shows the entry the teams it has used, and refuses a pick of one of them', async () => {
    const context = beforeWeek3();
    const { g5 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Alice'));
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedParticipantIds: expect.arrayContaining([context.team.Bills, context.team.Chiefs]) });
    expect(view.survivor?.usedParticipantIds).toHaveLength(2);

    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] }), 'PREDICTION_TEAM_ALREADY_USED', 409);
    expect(context.storedPicks('entry-alice')).not.toContain(g5.id);
  });

  /** Week 3 down to its Bills-Raiders game: a league of two teams, so Alice's two picks are a whole cycle. */
  function twoTeamWeek3(context: ReturnType<typeof beforeWeek3>) {
    const { g6 } = context.gamesByNumber;
    context.games.matches.delete(g6.id);
    for (const row of [...context.games.field.values()]) {
      if (row.sportEventId === context.week3.id && (row.participantId === context.team.Chiefs || row.participantId === context.team.Jets)) {
        context.games.field.delete(row.id);
      }
    }
  }

  it('lets an entry that has used every team pick them again, each entry in its own cycle', async () => {
    const context = beforeWeek3();
    twoTeamWeek3(context);
    const { g5 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Alice'));
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedParticipantIds: [] });

    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] });
    expect(context.storedPicks('entry-alice')).toContain(g5.id);
  });

  it('refuses a team already used, even once every team is used, when teams can never be picked again', async () => {
    const context = beforeWeek3({ reuseTeamsOnceAllUsed: false });
    twoTeamWeek3(context);
    const { g5 } = context.gamesByNumber;
    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] }), 'PREDICTION_TEAM_ALREADY_USED', 409);
  });

  it('replaces the week\'s pick when another team is picked, and submits the week with that one pick', async () => {
    const context = beforeWeek3();
    const { g5, g6 } = context.gamesByNumber;
    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Raiders')] });
    const view = await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g6, 'Jets')] });

    expect(view.pickedCount).toBe(1);
    expect(view.canSubmit).toBe(true);
    expect(context.storedPicks('entry-alice').filter((id) => id === g5.id || id === g6.id)).toEqual([g6.id]);
    const submitted = await context.predictions.submitGamePicks(context.input('Alice'));
    expect(submitted.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses two picks in one save, and a submit with no pick', async () => {
    const context = beforeWeek3();
    const { g5, g6 } = context.gamesByNumber;
    await expectRefused(
      context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Raiders'), context.pickOf(g6, 'Jets')] }),
      'PREDICTION_ONE_PICK_REQUIRED',
      409,
    );
    await expectRefused(context.predictions.submitGamePicks(context.input('Alice')), 'PREDICTION_ONE_PICK_REQUIRED', 409);
  });

  it('refuses every pick and submit of an entry that is out, and tells it the week it went out', async () => {
    const context = beforeWeek3();
    const { g6 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Bob'));
    expect(view.survivor?.eliminatedInWeek).toBe(2);
    expect(view.canSubmit).toBe(false);

    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Bob'), picks: [context.pickOf(g6, 'Jets')] }), 'PREDICTION_ENTRY_ELIMINATED', 409);
    await expectRefused(context.predictions.submitGamePicks(context.input('Bob')), 'PREDICTION_ENTRY_ELIMINATED', 409);
  });

  it('refuses to replace a pick whose game has kicked off with a pick on a later game', async () => {
    const context = beforeWeek3();
    const { g5, g6 } = context.gamesByNumber;
    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Raiders')] });
    await context.predictions.submitGamePicks(context.input('Alice'));
    context.setNow(later(WEEK_3, 1));

    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g6, 'Jets')] }), 'PREDICTION_GAME_STARTED', 409);
    expect(context.storedPicks('entry-alice')).toContain(g5.id);
  });

  it('lets a pick on a game cancelled mid-week be replaced by a pick on a game still to kick off, freeing the cancelled team', async () => {
    const context = beforeWeek3();
    const { g5, g6 } = context.gamesByNumber;
    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Raiders')] });
    await context.predictions.submitGamePicks(context.input('Alice'));
    // Bills v Raiders is called off after the week has started; Chiefs v Jets is still to kick off.
    context.setNow(later(WEEK_3, 1));
    context.cancel(g5);

    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g6, 'Jets')] });
    expect(context.storedPicks('entry-alice')).toEqual(['game-1', 'game-4', g6.id]);
  });

  it('hides the teams an entry has used from another team\'s members, as they could show picks not yet revealed', async () => {
    const context = beforeWeek3();
    const view = await context.predictions.getGamePicks({ ...context.input('Alice'), actorUserId: context.userOf('Bob') });
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedParticipantIds: null });
  });
});

describe('ContestService.getSurvivorLeaderboard', () => {
  it('ranks entries still in first, then by weeks survived, with entries out in the same week sharing a place', async () => {
    const context = setup();
    context.playWeek1();
    context.play(context.gamesByNumber.g3, MatchSide.HOME);
    // Week 2 is under way: the Bills have beaten the Jets, the Chiefs have not played.
    context.setNow(later(WEEK_2, 2));
    const board = await context.leaderboard();

    expect(board.entries.map((entry) => [entry.entryName, entry.displayPosition, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived])).toEqual([
      ['Alice', '1', true, null, 1],
      ['Bob', 'T2', false, 2, 1],
      ['Dan', 'T2', false, 2, 1],
      ['Cara', '4', false, 1, 0],
    ]);
    // Still in after each week: week 1's three survivors; in week 2 only Alice, her game still to play.
    expect(board.weeks.map((week) => [week.weekNumber, week.started, week.aliveCount])).toEqual([[1, true, 3], [2, true, 1], [3, false, 0]]);
  });

  it('shows a picked team from its game\'s kickoff and each week\'s outcome, nothing for a week after the entry went out', async () => {
    const context = setup();
    context.playWeek1();
    context.play(context.gamesByNumber.g3, MatchSide.HOME);
    context.setNow(later(WEEK_2, 2));
    const board = await context.leaderboard();
    const weeksOf = (name: string) => expectDefined(board.entries.find((entry) => entry.entryName === name)).weeks
      .map((week) => [week.outcome, week.team]);

    // Alice's week 2 pick is on the Chiefs' game, not yet kicked off.
    expect(weeksOf('Alice')).toEqual([[SurvivorWeekOutcome.SURVIVED, 'Bills'], [SurvivorWeekOutcome.PENDING, null], [null, null]]);
    expect(weeksOf('Bob')).toEqual([[SurvivorWeekOutcome.SURVIVED, 'Chiefs'], [SurvivorWeekOutcome.ELIMINATED, 'Jets'], [null, null]]);
    expect(weeksOf('Cara')).toEqual([[SurvivorWeekOutcome.ELIMINATED, 'Jets'], [null, null], [null, null]]);
  });

  it('names no team for a week the entry left in draft, even once that pick\'s game has kicked off', async () => {
    const context = setup();
    context.playWeek1();
    context.playWeek2();
    // After the Chiefs v Raiders kickoff, where Dan's unsubmitted week 2 pick is.
    context.setNow(later(WEEK_2, 26));
    const board = await context.leaderboard();
    const dan = expectDefined(board.entries.find((entry) => entry.entryName === 'Dan'));

    expect(dan.weeks.map((week) => [week.outcome, week.team])).toEqual([
      [SurvivorWeekOutcome.SURVIVED, 'Bills'],
      [SurvivorWeekOutcome.ELIMINATED, null],
      [null, null],
    ]);
  });

  it('refuses a contest that is not a survivor contest', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contest, selectionType: SelectionType.PICK_EM });
    await expect(context.leaderboard()).rejects.toBeInstanceOf(ContestOperationError);
  });
});

describe('ContestSettlementService — a survivor contest', () => {
  it('freezes 1 for each entry that survived a week and 0 for one that went out in it, and nothing for an entry already out', async () => {
    const context = setup();
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));
    context.playWeek2();
    await settle(context, context.week2.id, later(WEEK_2, 48));

    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    const week = (sportEventId: string) => frozen
      .filter((standing) => standing.sportEventId === sportEventId)
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(week(context.week1.id)).toEqual([['entry-alice', 1, 'T1'], ['entry-bob', 1, 'T1'], ['entry-cara', 0, '4'], ['entry-dan', 1, 'T1']]);
    expect(week(context.week2.id)).toEqual([['entry-alice', 1, '1'], ['entry-bob', 0, 'T2'], ['entry-dan', 0, 'T2']]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.ACTIVE);
  });

  it('counts a pick on a cancelled game as surviving, and completes the contest with weeks survived as the total once the last week settles', async () => {
    const context = setup();
    // Alice picks the Raiders in week 3, on the game that is cancelled.
    context.games.predictions.set('entry-alice:game-5', {
      id: 'prediction-alice-5', contestEntryId: 'entry-alice', sportEventMatchId: 'game-5',
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: context.sideOf(context.gamesByNumber.g5, 'Raiders'), confidence: null, pickedAt: T0, createdAt: T0, updatedAt: T0,
    });
    const alice = expectDefined(context.world.entries.get('entry-alice'));
    context.world.entries.set(alice.id, {
      ...alice,
      events: alice.events.map((event) => (event.sportEventId === context.week3.id ? { ...event, status: ContestEntryStatus.SUBMITTED } : event)),
    });
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));
    context.playWeek2();
    await settle(context, context.week2.id, later(WEEK_2, 48));
    context.playWeek3();
    const summary = await settle(context, context.week3.id, later(WEEK_3, 48));

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    const totals = (await context.world.standingRepo().findByContest(context.contest.id))
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(totals).toEqual([['entry-alice', 3, '1'], ['entry-bob', 1, 'T2'], ['entry-cara', 0, '4'], ['entry-dan', 1, 'T2']]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
  });

  it('ranks the settled season by the run, not the weekly snapshots, when a postponed week 1 game is played after week 2 settled', async () => {
    const context = setup();
    const { g1, g2, g3, g4 } = context.gamesByNumber;
    // Bills v Jets is postponed: week 2 is played and settles while week 1 is still open.
    context.play(g2, MatchSide.HOME);
    context.play(g3, MatchSide.HOME);
    context.play(g4, MatchSide.HOME);
    await settle(context, context.week2.id, later(WEEK_2, 48));
    // Then the Jets win it, putting out Alice and Dan in week 1, and week 1 settles.
    context.play(g1, MatchSide.AWAY);
    await settle(context, context.week1.id, later(WEEK_2, 72));
    context.playWeek3();
    await settle(context, context.week3.id, later(WEEK_3, 48));

    // Week 2's snapshot froze a 1 for Alice, who the run puts out in week 1 with no week survived.
    const totals = (await context.world.standingRepo().findByContest(context.contest.id))
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(totals).toEqual([['entry-alice', 0, 'T3'], ['entry-bob', 1, 'T1'], ['entry-cara', 1, 'T1'], ['entry-dan', 0, 'T3']]);
    const board = await context.leaderboard();
    expect(board.entries.map((entry) => [entry.entryName, entry.weeksSurvived, entry.displayPosition]))
      .toEqual([['Bob', 1, 'T1'], ['Cara', 1, 'T1'], ['Alice', 0, 'T3'], ['Dan', 0, 'T3']]);
  });
});
