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
import { fakeLogger } from '../../support/fake-logger';
import { expect, jest } from '@jest/globals';
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
import { loadSurvivorWeeks } from '../../../packages/core-api/src/modules/contests/survivor-standings';
import { survivorPickOutcome, survivorRun, survivorTeamsUsedInCycle, type SurvivorWeek } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/survivor';
import { PredictionIssueKind } from '../../../packages/core-api/src/modules/selections/prediction-engines/prediction-engine';
import { survivorPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/survivor';
import { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import { expectDefined } from '../../support/expect-defined';
import { placeOnStoredBoard, storeUnderOlderBoardFormat } from '../../support/in-memory-leaderboard-snapshots';
import { LEADERBOARD_BOARD_FORMAT } from '../../../packages/core-api/src/modules/contests/leaderboard-snapshots';
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

function setup(rules: { reuseTeamsOnceAllUsed?: boolean; lives?: number } = {}) {
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
  const shortNames: Partial<Record<TeamName, string>> = { Bills: 'BUF', Chiefs: 'KC', Raiders: 'LV' };
  for (const [name, participantId] of Object.entries(team)) {
    const shortName = shortNames[name as TeamName];
    games.participants.set(participantId, { ...expectDefined(games.participants.get(participantId)), name, ...(shortName === undefined ? {} : { shortName }) });
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
    fieldRows: games.fieldRepo(),
    eventParticipants: games.fieldService(),
    now: () => now,
  });
  const contestService = new ContestService(deps);
  const settlement = new ContestSettlementService({ ...deps, contests: world.contestRepo(), sportEvents: world.sportEventRepo(), squares: fakeSquaresRepo(), championship: { recordContest: async () => 0 } });
  // The season reads a test counts (#1201).
  const seasonReads = { sportEvents: world.sportEventRepo(), matches: games.matchRepo() };
  const predictions = new PredictionService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    scoringRules: world.scoringRuleRepo(),
    entries: world.entryRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: seasonReads.sportEvents,
    matches: seasonReads.matches,
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
    world, games, contest, week1, week2, week3, team, deps, contestService, settlement, predictions, seasonReads,
    gamesByNumber: { g1, g2, g3, g4, g5, g6 },
    sideOf, play, cancel, setEventStatus,
    userOf: (name: string) => expectDefined(users.get(name)),
    setNow: (when: Date) => { now = when; },
    /** Each week's results as the file comment tells them. */
    playWeek1: () => { play(g1, MatchSide.HOME); play(g2, MatchSide.HOME); },
    playWeek2: () => { play(g3, MatchSide.HOME); play(g4, MatchSide.HOME); },
    playWeek3: () => { cancel(g5); play(g6, MatchSide.HOME); },
    leaderboard: () => contestService.getSurvivorLeaderboard(contest.id, viewerId).then((read) => read.board),
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
    homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED, advancesToMatchId: null, advancesToSide: null, regionLabel: null, homeSpread: null, externalGameId: null, resultSource: null, periodScores: [],
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
    ], 1);
    expect(run.weeks.map((week) => week.outcome)).toEqual([SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.ELIMINATED, null]);
    expect(run).toMatchObject({ eliminatedAt: 1, weeksSurvived: 1 });
    expect([...run.usedParticipantIds]).toEqual(['bills', 'jets']);
  });

  it('puts the entry out in a started week it did not submit, but not in one not yet started', () => {
    expect(survivorRun([survivorWeek({ sportEventId: 'w1', ...winning, submitted: false })], 1).eliminatedAt).toBe(0);
    const ahead = survivorRun([survivorWeek({ sportEventId: 'w1', started: false, submitted: false, pick: null })], 1);
    expect(ahead).toMatchObject({ eliminatedAt: null, weeksSurvived: 0 });
    expect(ahead.weeks[0]?.outcome).toBeNull();
  });

  it('lets a cancelled week count for nothing: no one goes out for it and it uses up no team', () => {
    const run = survivorRun([
      survivorWeek({ sportEventId: 'w1', cancelled: true, submitted: false, pickedParticipantId: 'bills' }),
      survivorWeek({ sportEventId: 'w2', ...winning, pickedParticipantId: 'chiefs' }),
    ], 1);
    expect(run.weeks.map((week) => week.outcome)).toEqual([null, SurvivorWeekOutcome.SURVIVED]);
    expect(run).toMatchObject({ eliminatedAt: null, weeksSurvived: 1 });
    expect([...run.usedParticipantIds]).toEqual(['chiefs']);
  });
  it('keeps an entry with two lives in after its first loss, a life lost, and puts it out at its second', () => {
    const run = survivorRun([
      survivorWeek({ sportEventId: 'w1', ...losing, pickedParticipantId: 'jets' }),
      survivorWeek({ sportEventId: 'w2', ...winning, pickedParticipantId: 'bills' }),
      survivorWeek({ sportEventId: 'w3', ...losing, pickedParticipantId: 'raiders' }),
      survivorWeek({ sportEventId: 'w4', ...winning, pickedParticipantId: 'chiefs' }),
    ], 2);
    expect(run.weeks.map((week) => week.outcome)).toEqual([SurvivorWeekOutcome.LIFE_LOST, SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.ELIMINATED, null]);
    expect(run).toMatchObject({ eliminatedAt: 2, weeksSurvived: 1, livesLost: 2, livesLeft: 0 });
    // The team picked in the week the life was lost is used, as any other pick is.
    expect([...run.usedParticipantIds]).toEqual(['jets', 'bills', 'raiders']);
  });

  it('costs a life, not the entry, for a tie or a week not submitted when the entry has two lives', () => {
    const tied = game('t', { status: MatchStatus.COMPLETED, winnerSide: null });
    const run = survivorRun([
      survivorWeek({ sportEventId: 'w1', games: [tied], pick: { sportEventMatchId: 't', sportEventParticipantId: 't-home' }, pickedParticipantId: 'bills' }),
    ], 2);
    expect(run.weeks[0]?.outcome).toBe(SurvivorWeekOutcome.LIFE_LOST);
    expect(run).toMatchObject({ eliminatedAt: null, livesLost: 1, livesLeft: 1 });

    const missed = survivorRun([
      survivorWeek({ sportEventId: 'w1', ...winning, submitted: false }),
      survivorWeek({ sportEventId: 'w2', ...winning, pickedParticipantId: 'chiefs' }),
      survivorWeek({ sportEventId: 'w3', ...winning, submitted: false }),
    ], 2);
    expect(missed.weeks.map((week) => week.outcome)).toEqual([SurvivorWeekOutcome.LIFE_LOST, SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.ELIMINATED]);
    expect(missed).toMatchObject({ eliminatedAt: 2, weeksSurvived: 1, livesLeft: 0 });
  });

  it('leaves every life to an entry that has lost no week, and one life to a one-life entry still in', () => {
    expect(survivorRun([survivorWeek({ sportEventId: 'w1', ...winning, pickedParticipantId: 'bills' })], 2)).toMatchObject({ livesLost: 0, livesLeft: 2 });
    expect(survivorRun([survivorWeek({ sportEventId: 'w1', ...winning, pickedParticipantId: 'bills' })], 1)).toMatchObject({ livesLost: 0, livesLeft: 1 });
    expect(survivorRun([survivorWeek({ sportEventId: 'w1', ...losing, pickedParticipantId: 'jets' })], 1)).toMatchObject({ livesLost: 1, livesLeft: 0, eliminatedAt: 0 });
  });
});

describe('survivorTeamsUsedInCycle', () => {
  it('counts every other week\'s pick when each team is used once all season', () => {
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', null, 'd'], 3, null).keys()]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a new cycle once the entry has used every team, so the first cycle\'s teams can be picked again', () => {
    // Three teams: weeks 1-3 use all of them, so week 4 starts the second cycle.
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', null], 3, 3).keys()]).toEqual([]);
    expect([...survivorTeamsUsedInCycle(['a', 'b', 'c', 'a', null], 4, 3).keys()]).toEqual(['a']);
  });

  it('keeps the week in its own cycle, counting a pick made ahead in a later week of that cycle', () => {
    expect([...survivorTeamsUsedInCycle(['a', null, 'b'], 1, 3).keys()]).toEqual(['a', 'b']);
    // Week 2 closes the first cycle, so week 4's pick ahead belongs to the second one.
    expect([...survivorTeamsUsedInCycle(['a', 'b', null, 'c'], 1, 2).keys()]).toEqual(['a']);
  });

  it('skips weeks with no counted pick, so a cycle closes only on teams actually used', () => {
    expect([...survivorTeamsUsedInCycle(['a', null, 'b', null], 3, 3).keys()]).toEqual(['a', 'b']);
  });
});

describe('survivorPredictionEngine', () => {
  const games = [game('a'), game('b')];

  it('keeps the latest pick of the week and clears the other, as a new pick replaces the entry\'s one', () => {
    const first = { sportEventMatchId: 'a', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'a-home', confidence: null };
    const second = { sportEventMatchId: 'b', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'b-away', confidence: null };
    const resolved = survivorPredictionEngine.resolvePicks({ games, predictions: [first, second], seedOf: new Map(), withdrawn: new Set() });
    expect(resolved.kept).toEqual([second]);
    expect(resolved.stranded).toEqual([first]);
  });

  it('refuses a week with no pick or two, a team used in another week, and any week of an entry that is out', () => {
    // The week under test is week 3 of the contest, one round of games a and b.
    const season = {
      usedTeamWeeks: new Map([['bills', 1]]),
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
  function beforeWeek3(rules: { reuseTeamsOnceAllUsed?: boolean; lives?: number } = {}) {
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

  it('reads the week once and only the season\'s other weeks for the teams used, never the week again', async () => {
    const context = beforeWeek3();
    const eventReads = jest.spyOn(context.seasonReads.sportEvents, 'findByIds');
    const weekMatchReads = jest.spyOn(context.seasonReads.matches, 'findBySportEvent');
    const seasonMatchReads = jest.spyOn(context.seasonReads.matches, 'findBySportEvents');
    const view = await context.predictions.getGamePicks(context.input('Alice'));

    expect(view.survivor?.usedTeams).toHaveLength(2);
    expect(eventReads.mock.calls).toEqual([[[context.week3.id]], [[context.week1.id, context.week2.id]]]);
    expect(weekMatchReads.mock.calls).toEqual([[context.week3.id]]);
    expect(seasonMatchReads.mock.calls).toEqual([[[context.week1.id, context.week2.id]]]);
  });

  it('builds the same season from a week already loaded as from reading every week', async () => {
    const context = beforeWeek3();
    const now = later(WEEK_3, -2);
    const week3 = expectDefined(await context.seasonReads.sportEvents.findById(context.week3.id) ?? undefined);
    const loaded = { sportEvent: week3, matches: await context.seasonReads.matches.findBySportEvent(week3.id) };

    expect(await loadSurvivorWeeks(context.seasonReads, context.contest, now, loaded))
      .toEqual(await loadSurvivorWeeks(context.seasonReads, context.contest, now));
  });

  it('shows the entry the teams it has used, and refuses a pick of one of them', async () => {
    const context = beforeWeek3();
    const { g5 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Alice'));
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedTeams: expect.arrayContaining([{ participantId: context.team.Bills, weekNumber: 1 }, { participantId: context.team.Chiefs, weekNumber: 2 }]), roundWeeks: [{ roundNumber: 1, weekNumber: 3 }] });
    expect(view.survivor?.usedTeams).toHaveLength(2);

    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] }), 'PREDICTION_TEAM_ALREADY_USED', 409);
    expect(context.storedPicks('entry-alice')).not.toContain(g5.id);
  });

  /** Week 3 down to its Bills-Raiders game: a smaller field than the four teams the season has. */
  function twoTeamWeek3(context: ReturnType<typeof beforeWeek3>) {
    const { g6 } = context.gamesByNumber;
    context.games.matches.delete(g6.id);
    for (const row of [...context.games.field.values()]) {
      if (row.sportEventId === context.week3.id && (row.participantId === context.team.Chiefs || row.participantId === context.team.Jets)) {
        context.games.field.delete(row.id);
      }
    }
  }

  /**
   * A league of two teams, Bills and Raiders: every week's field loses Chiefs and Jets, and Alice
   * survives week 2 on the Raiders, so her two picks are a whole cycle.
   */
  function twoTeamLeague(context: ReturnType<typeof beforeWeek3>) {
    const { g4 } = context.gamesByNumber;
    context.play(g4, MatchSide.AWAY);
    const prediction = expectDefined(context.games.predictions.get(`entry-alice:${g4.id}`));
    context.games.predictions.set(`entry-alice:${g4.id}`, { ...prediction, predictedResult: PredictedResult.TEAM, sportEventParticipantId: context.sideOf(g4, 'Raiders') });
    twoTeamWeek3(context);
    for (const row of [...context.games.field.values()]) {
      if (row.participantId === context.team.Chiefs || row.participantId === context.team.Jets) context.games.field.delete(row.id);
    }
  }

  it('lets an entry that has used every team in the league pick them again, each entry in its own cycle', async () => {
    const context = beforeWeek3();
    twoTeamLeague(context);
    const { g5 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Alice'));
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedTeams: [], roundWeeks: [{ roundNumber: 1, weekNumber: 3 }] });

    await context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] });
    expect(context.storedPicks('entry-alice')).toContain(g5.id);
  });

  it('counts every team in the contest\'s weeks, so a week with a smaller field (a postponed game) does not end the cycle early', async () => {
    const context = beforeWeek3();
    twoTeamWeek3(context);
    const { g5 } = context.gamesByNumber;
    const view = await context.predictions.getGamePicks(context.input('Alice'));
    expect((view.survivor?.usedTeams ?? []).map((used) => used.participantId).sort()).toEqual([context.team.Bills, context.team.Chiefs].sort());

    await expectRefused(context.predictions.saveGamePicks({ ...context.input('Alice'), picks: [context.pickOf(g5, 'Bills')] }), 'PREDICTION_TEAM_ALREADY_USED', 409);
  });

  it('refuses a team already used, even once every team is used, when teams can never be picked again', async () => {
    const context = beforeWeek3({ reuseTeamsOnceAllUsed: false });
    twoTeamLeague(context);
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
    expect(view.survivor).toEqual({ eliminatedInWeek: null, usedTeams: null, roundWeeks: [{ roundNumber: 1, weekNumber: 3 }] });
  });
});

describe('ContestService.getSurvivorLeaderboard', () => {
  it('gives a cup the stored survivor board\'s places while it is current, rather than computing the board again (#1575)', async () => {
    const context = setup();
    context.playWeek1();
    context.setNow(later(WEEK_2, 2));
    await context.leaderboard();
    // Cara's place on the stored board only: a computed board would rank her last.
    placeOnStoredBoard(context.world.leaderboardSnapshots, context.contest.id, 'entry-cara', 1);
    const cara = expectDefined(context.world.entries.get('entry-cara')).squadId;

    expect(await context.contestService.livePositionsOf(context.contest.id)).toContainEqual({ squadId: cara, position: 1 });
  });

  it('asks for a cup contest\'s stale stored survivor board to be rebuilt, rather than computing it on every projection and never storing it (#1788)', async () => {
    const context = setup();
    context.playWeek1();
    context.setNow(later(WEEK_2, 2));
    await context.leaderboard();
    storeUnderOlderBoardFormat(context.world.leaderboardSnapshots, context.contest.id);

    await context.contestService.livePositionsOfMany([context.contest.id]);
    await context.contestService.livePositionsOf(context.contest.id);

    expect(context.world.leaderboardRebuildsAsked).toEqual([[context.contest.id], [context.contest.id]]);
  });

  it('computes the survivor board again, rather than answering from the stored one, when that was stored under an older board format (#1761)', async () => {
    const context = setup();
    context.playWeek1();
    context.setNow(later(WEEK_2, 2));
    const computed = await context.leaderboard();
    // A place only the stored board holds: a read answering from it would show it.
    placeOnStoredBoard(context.world.leaderboardSnapshots, context.contest.id, 'entry-cara', 1);
    storeUnderOlderBoardFormat(context.world.leaderboardSnapshots, context.contest.id);

    expect(await context.leaderboard()).toEqual(computed);
    expect([...context.world.leaderboardSnapshots.rows.values()].map((row) => row.boardFormat)).toEqual([LEADERBOARD_BOARD_FORMAT]);
  });

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

  it('gives each shown pick its game: the opponent, home or away, kickoff, status and both scores, and the team\'s short name', async () => {
    const context = setup();
    context.playWeek1();
    context.setNow(later(WEEK_2, 2));
    const board = await context.leaderboard();
    const weekOf = (name: string, index: number) => expectDefined(expectDefined(board.entries.find((entry) => entry.entryName === name)).weeks[index]);

    // Bob's Chiefs beat the Raiders at home, 20-10.
    expect(weekOf('Bob', 0)).toMatchObject({
      team: 'Chiefs',
      teamShortName: 'KC',
      game: {
        opponent: 'Raiders', opponentShortName: 'LV', side: MatchSide.HOME, isNeutralSite: false,
        scheduledDate: later(WEEK_1, 24).toISOString(), status: MatchStatus.COMPLETED, teamScore: 20, opponentScore: 10,
      },
    });
    // Cara's Jets lost away to the Bills, 10-20; the Jets have no short name.
    expect(weekOf('Cara', 0)).toMatchObject({
      team: 'Jets',
      teamShortName: null,
      game: { opponent: 'Bills', opponentShortName: 'BUF', side: MatchSide.AWAY, teamScore: 10, opponentScore: 20 },
    });
    // A pick not yet kicked off shows neither its team nor its game.
    expect(weekOf('Alice', 1)).toMatchObject({ team: null, teamShortName: null, game: null });
  });

  it('shows a pick\'s team without its game, and warns, when the opponent\'s team is missing from the participants', async () => {
    const context = setup();
    context.playWeek1();
    context.setNow(later(WEEK_2, 2));
    context.games.participants.delete(context.team.Raiders);
    const logger = fakeLogger();
    const read = await new ContestService({ ...context.deps, logger }).getSurvivorLeaderboard(context.contest.id, context.userOf('Bob'));

    expect(expectDefined(read.board.entries.find((entry) => entry.entryName === 'Bob')).weeks[0]).toMatchObject({ team: 'Chiefs', game: null });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ contestId: context.contest.id, participantId: context.team.Raiders }),
      'survivor leaderboard pick game opponent missing',
    );
  });

  it('keeps the stored board only until the next game kicks off, then shows the team picked for it (#1435)', async () => {
    const context = setup();
    context.playWeek1();
    context.play(context.gamesByNumber.g3, MatchSide.HOME);
    context.setNow(later(WEEK_2, 2));
    await context.leaderboard();

    // The Chiefs v Raiders kickoff reveals Alice's week 2 pick: the stored board is good until then.
    expect([...context.world.leaderboardSnapshots.rows.values()].map((row) => row.validUntil)).toEqual([later(WEEK_2, 24)]);
    context.setNow(new Date(later(WEEK_2, 24).getTime() + 1));
    const board = await context.leaderboard();
    expect(expectDefined(board.entries.find((entry) => entry.entryName === 'Alice')).weeks[1]?.team).toBe('Chiefs');
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

  it('freezes no standings for a cancelled week and leaves the contest live', async () => {
    const context = setup();
    context.setEventStatus(context.week1.id, SportEventStatus.CANCELLED);

    const summary = await context.settlement.settleFinishedSportEvent(context.week1.id, { completedAt: later(WEEK_1, 48) });

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 0, standingsUpserted: 0 });
    expect(await context.world.eventStandingRepo().findByContest(context.contest.id)).toEqual([]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.ACTIVE);
  });

  it('keeps a week\'s frozen standings when the week is settled again', async () => {
    const context = setup();
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));

    await settle(context, context.week1.id, later(WEEK_1, 96));

    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    expect(new Set(frozen.map((standing) => standing.settledAt.getTime()))).toEqual(new Set([later(WEEK_1, 48).getTime()]));
  });

  it('freezes the same weeks survived and places the live survivor leaderboard showed with the last week\'s games final (#1435)', async () => {
    const context = setup();
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));
    context.playWeek2();
    await settle(context, context.week2.id, later(WEEK_2, 48));
    context.playWeek3();
    context.setNow(later(WEEK_3, 24));
    const live = await context.leaderboard();

    await settle(context, context.week3.id, later(WEEK_3, 48));

    const totals = (await context.world.standingRepo().findByContest(context.contest.id))
      .sort((left, right) => (left.position ?? Infinity) - (right.position ?? Infinity) || left.contestEntryId.localeCompare(right.contestEntryId))
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition]);
    expect(totals).toEqual(live.entries.map((entry) => [entry.entryId, entry.weeksSurvived, entry.displayPosition]));
  });

  it('reads the season\'s weeks and games once for every survivor contest on the last week, and completes each of them', async () => {
    const context = setup();
    const second = context.world.addContest(context.world.addLeague().id, {
      name: 'Second survivor',
      status: ContestStatus.ACTIVE,
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.SURVIVOR,
      sportEventIds: [context.week1.id, context.week2.id, context.week3.id],
    });
    context.world.addConfiguration(second.id, {
      selectionType: SelectionType.SURVIVOR,
      configJson: { selectionType: SelectionType.SURVIVOR },
    });
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));
    context.playWeek2();
    await settle(context, context.week2.id, later(WEEK_2, 48));
    context.playWeek3();
    context.setEventStatus(context.week3.id, SportEventStatus.COMPLETED);
    const reads: string[] = [];
    const matches = context.games.matchRepo();
    const sportEvents = context.world.sportEventRepo();
    const settlement = new ContestSettlementService({
      ...context.deps,
      matches: {
        findBySportEvent: async (sportEventId) => {
          reads.push(`matches:${sportEventId}`);
          return matches.findBySportEvent(sportEventId);
        },
        findBySportEvents: async (sportEventIds) => {
          reads.push(...sportEventIds.map((sportEventId) => `matches:${sportEventId}`));
          return matches.findBySportEvents(sportEventIds);
        },
      },
      sportEvents: {
        ...sportEvents,
        findByIds: async (ids) => {
          reads.push(...ids.map((id) => `event:${id}`));
          return sportEvents.findByIds(ids);
        },
      },
      contests: context.world.contestRepo(),
      squares: fakeSquaresRepo(),
      championship: { recordContest: async () => 0 },
    });

    const summary = await settlement.settleFinishedSportEvent(context.week3.id, { completedAt: later(WEEK_3, 48) });

    expect(summary).toMatchObject({ contestsSettled: 2, contestsCompleted: 2 });
    const weeks = [context.week1.id, context.week2.id, context.week3.id];
    // The week being settled is already in hand, so only the other two are read.
    expect(reads.sort()).toEqual([
      ...[context.week1.id, context.week2.id].map((id) => `event:${id}`),
      ...weeks.map((id) => `matches:${id}`),
    ].sort());
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

describe('A survivor contest with two lives', () => {
  // With two lives: Bob loses week 2 (the Jets) and stays in; Dan leaves week 2 in draft and
  // stays in; Cara loses week 1, then misses week 2, and is out in week 2.
  const twoLives = { lives: 2 };

  it('ranks entries still in by lives left before weeks survived, so an entry yet to lose ranks above one that lost a life', async () => {
    const context = setup(twoLives);
    context.playWeek1();
    context.play(context.gamesByNumber.g3, MatchSide.HOME);
    // Week 2 is under way: Alice's Chiefs have not played, so she, Bob and Dan have each survived one week.
    context.setNow(later(WEEK_2, 2));
    const board = await context.leaderboard();

    expect(board.entries.map((entry) => [entry.entryName, entry.displayPosition, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived, entry.livesLeft, entry.livesLost])).toEqual([
      ['Alice', '1', true, null, 1, 2, 0],
      ['Bob', 'T2', true, null, 1, 1, 1],
      ['Dan', 'T2', true, null, 1, 1, 1],
      ['Cara', '4', false, 2, 0, 0, 2],
    ]);
    // Week 1's lost life keeps Cara counted in after it; week 2 keeps everyone but Cara.
    expect(board.weeks.map((week) => [week.weekNumber, week.aliveCount])).toEqual([[1, 4], [2, 3], [3, 0]]);
  });

  it('marks a lost life\'s week as a life lost, distinct from the week that puts the entry out', async () => {
    const context = setup(twoLives);
    context.playWeek1();
    context.playWeek2();
    context.setNow(later(WEEK_2, 26));
    const board = await context.leaderboard();
    const weeksOf = (name: string) => expectDefined(board.entries.find((entry) => entry.entryName === name)).weeks.map((week) => week.outcome);

    expect(weeksOf('Bob')).toEqual([SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.LIFE_LOST, null]);
    expect(weeksOf('Cara')).toEqual([SurvivorWeekOutcome.LIFE_LOST, SurvivorWeekOutcome.ELIMINATED, null]);
  });

  it('ranks a one-life contest exactly as before: every entry has one life, lost when it goes out', async () => {
    const context = setup();
    context.playWeek1();
    context.playWeek2();
    context.setNow(later(WEEK_2, 26));
    const board = await context.leaderboard();

    expect(board.entries.map((entry) => [entry.entryName, entry.displayPosition, entry.livesLeft, entry.livesLost])).toEqual([
      ['Alice', '1', 1, 0],
      ['Bob', 'T2', 0, 1],
      ['Dan', 'T2', 0, 1],
      ['Cara', '4', 0, 1],
    ]);
  });

  it('tells the pick screen the week each used team was picked in, the lost week\'s team included', async () => {
    const context = setup(twoLives);
    context.playWeek1();
    context.playWeek2();
    context.setEventStatus(context.week1.id, SportEventStatus.COMPLETED);
    context.setEventStatus(context.week2.id, SportEventStatus.COMPLETED);
    context.setNow(later(WEEK_3, -2));
    const view = await context.predictions.getGamePicks({ contestId: context.contest.id, entryId: 'entry-bob', sportEventId: context.week3.id, actorUserId: context.userOf('Bob') });

    expect(view.survivor?.usedTeams).toEqual([
      { participantId: context.team.Chiefs, weekNumber: 1 },
      { participantId: context.team.Jets, weekNumber: 2 },
    ]);
  });

  it('lets an entry that lost a life keep picking, never the team it lost with', async () => {
    const context = setup(twoLives);
    context.playWeek1();
    context.playWeek2();
    context.setEventStatus(context.week1.id, SportEventStatus.COMPLETED);
    context.setEventStatus(context.week2.id, SportEventStatus.COMPLETED);
    context.setNow(later(WEEK_3, -2));
    const { g5, g6 } = context.gamesByNumber;
    const input = { contestId: context.contest.id, entryId: 'entry-bob', sportEventId: context.week3.id, actorUserId: context.userOf('Bob') };
    const pickOf = (game: SportEventMatch, name: TeamName) => ({ sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: context.sideOf(game, name), confidence: null });

    const view = await context.predictions.getGamePicks(input);
    expect(view.survivor?.eliminatedInWeek).toBeNull();
    await expectRefused(context.predictions.saveGamePicks({ ...input, picks: [pickOf(g6, 'Jets')] }), 'PREDICTION_TEAM_ALREADY_USED', 409);
    await context.predictions.saveGamePicks({ ...input, picks: [pickOf(g5, 'Bills')] });
    await context.predictions.submitGamePicks(input);
    expect(context.storedPicks('entry-bob')).toContain(g5.id);
  });

  it('settles a lost life\'s week as decided with no week survived, and ranks the season by lives, then weeks survived', async () => {
    const context = setup(twoLives);
    context.playWeek1();
    await settle(context, context.week1.id, later(WEEK_1, 48));
    context.playWeek2();
    await settle(context, context.week2.id, later(WEEK_2, 48));
    const frozen = await context.world.eventStandingRepo().findByContest(context.contest.id);
    const week2 = frozen
      .filter((standing) => standing.sportEventId === context.week2.id)
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    // Cara, out in week 2, and Bob and Dan, who lost a life in it, each settle week 2 at 0.
    expect(week2).toEqual([['entry-alice', 1, '1'], ['entry-bob', 0, 'T2'], ['entry-cara', 0, 'T2'], ['entry-dan', 0, 'T2']]);

    // Nobody picks week 3: Alice loses her first life and stays in; Bob and Dan go out in it.
    context.playWeek3();
    const summary = await settle(context, context.week3.id, later(WEEK_3, 48));
    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    const totals = (await context.world.standingRepo().findByContest(context.contest.id))
      .map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(totals).toEqual([['entry-alice', 2, '1'], ['entry-bob', 1, 'T2'], ['entry-cara', 0, '4'], ['entry-dan', 1, 'T2']]);
  });
});
