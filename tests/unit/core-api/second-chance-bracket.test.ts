/**
 * A second-chance bracket (#721): a BRACKET contest whose rules start at a later round, made and
 * entered while its knockout is already under way. Its window runs on its starting round's first
 * game rather than the event's start: entries, picks and the tiebreaker stay open while the event
 * is IN_PROGRESS until that game, the picks are hidden from other teams until then, the contest
 * goes live then, and only the games from that round on are picked and scored.
 *
 * One in-memory world for every service the contest passes through, so the tests assert the stored
 * picks, entries, contest status and views rather than the calls.
 *
 * The bracket is the eight-team fixture over three rounds worth 1, 2 and 4. Round 1 was played two
 * days ago: T1, T2 and T3 won at home and T5 upset T4, so round 2 is T1 against T5 (game 5, two
 * hours from the test's clock) and T2 against T3 (game 6, five hours from it). The final is game 7.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  MatchStatus,
  PickOutcome,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  UpsetBonusRule,
  contestEntryEventStatus,
  type ContestEntry,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import type { SportEventRepository } from '@poolmaster/shared/db';
import { loadBracketStandings } from '../../../packages/core-api/src/modules/contests/bracket-standings';
import { ContestService } from '../../../packages/core-api/src/modules/contests/service';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { PredictionService, type GamePicksView } from '../../../packages/core-api/src/modules/selections/prediction-service';
import {
  EIGHT_SEEDS,
  bracketPick,
  eightTeamBracket,
  knockoutScoringRule,
  withResults,
  type GameResult,
} from '../../support/bracket-fixtures';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeParticipantContestScoringRuleRepo } from '../../support/repo-fakes';

const HOUR = 60 * 60 * 1000;
/** The test's clock: every time below is relative to it, so nothing depends on today's date. */
const NOW = new Date('2027-03-20T12:00:00.000Z');
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);
const T0 = at(-24 * 30);

const { HOME, AWAY } = MatchSide;
/** When each game tips off, in hours from the clock: round 1 two days ago, round 2 later today. */
const KICKOFF_HOURS = new Map([[1, -48], [2, -48], [3, -46], [4, -46], [5, 2], [6, 5], [7, 50]]);
const ROUND_TWO_FIRST_GAME = at(2);

/** Round 1 played (T5 upsetting T4) and round 2 placed by its results, as the admin's results leave it. */
function bracketAfterRoundOne(sportEventId: string): SportEventMatch[] {
  const played = withResults(eightTeamBracket(sportEventId), new Map<number, GameResult>([
    [1, { winner: HOME }], [2, { winner: AWAY }], [3, { winner: HOME }], [4, { winner: HOME }],
  ]));
  const placed = new Map([[5, ['T1', 'T5']], [6, ['T2', 'T3']]]);
  return played.map((match) => {
    const sides = placed.get(match.matchNumber);
    return {
      ...match,
      scheduledDate: at(expectDefined(KICKOFF_HOURS.get(match.matchNumber))),
      ...(sides && { homeSportEventParticipantId: sides[0], awaySportEventParticipantId: sides[1] }),
    };
  });
}

/** Alice's round-2-on picks: T1 and T2 through, T1 winning it all. */
const ALICE = [bracketPick(5, 'T1'), bracketPick(6, 'T2'), bracketPick(7, 'T1')].map((each) => ({ ...each, confidence: null }));

function setup(options: { startsAtRound?: number } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const alice = world.addUser({ email: 'alice@example.com' });
  const bob = world.addUser({ email: 'bob@example.com' });
  world.addMember(league.id, alice.id);
  world.addMember(league.id, bob.id);
  const aliceSquad = world.addSquad(league.id, 'Alice FC');
  const bobSquad = world.addSquad(league.id, 'Bob United');
  world.addSquadMember(aliceSquad.id, alice.id);
  world.addSquadMember(bobSquad.id, bob.id);

  const sportEvent = world.addSportEvent({ name: 'Regional', startDate: at(-48), status: SportEventStatus.IN_PROGRESS });
  games.addBracket(bracketAfterRoundOne(sportEvent.id), EIGHT_SEEDS);
  const contest = world.addContest(league.id, {
    name: 'Second-chance bracket',
    status: ContestStatus.OPEN,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.BRACKET,
    sportEventIds: [sportEvent.id],
  });
  const configuration = world.addConfiguration(contest.id, {
    selectionType: SelectionType.BRACKET,
    configJson: { selectionType: SelectionType.BRACKET, startsAtRound: options.startsAtRound ?? 2 },
  });
  const rules = [knockoutScoringRule(configuration.id, { roundValues: [1, 2, 4], upsetBonus: { rule: UpsetBonusRule.NONE } })];
  const scoringRules = fakeParticipantContestScoringRuleRepo({ findByContestConfiguration: jest.fn().mockResolvedValue(rules) });
  const aliceEntry: ContestEntry = {
    id: 'entry-alice', contestId: contest.id, squadId: aliceSquad.id, entryNumber: 1, name: 'Alice FC',
    events: [{ sportEventId: sportEvent.id, status: ContestEntryStatus.DRAFT }], createdAt: T0, updatedAt: T0,
  };
  world.entries.set(aliceEntry.id, aliceEntry);

  let now = NOW;
  const clock = () => now;
  const predictions = new PredictionService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    scoringRules,
    entries: world.entryRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: world.sportEventRepo(),
    matches: games.matchRepo(),
    field: games.fieldRepo(),
    participants: games.participantRepo(),
    predictions: games.predictionRepo(),
    now: clock,
  });
  const deps = world.contestServiceDeps({
    scoringRules,
    eventParticipants: games.fieldService(),
    predictions: games.predictionRepo(),
    matches: games.matchRepo(),
    now: clock,
  });
  const contests = new ContestService(deps);
  // The lifecycle over the same world; an event's status write lands in it.
  const sportEvents: SportEventRepository = world.sportEventRepo();
  const lifecycle = new EventLifecycleService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    matches: games.matchRepo(),
  }, sportEvents, fakeLogger());

  const input = { contestId: contest.id, entryId: aliceEntry.id, sportEventId: sportEvent.id, actorUserId: alice.id };
  const entry = () => expectDefined(world.entries.get(aliceEntry.id));
  return {
    world, games, predictions, contests, lifecycle, deps, input, alice, bob, contest, sportEvent,
    status: () => contestEntryEventStatus(entry(), sportEvent.id),
    contestNow: () => expectDefined(world.contests.get(contest.id)),
    eventNow: () => expectDefined(world.sportEvents.get(sportEvent.id)),
    setNow: (when: Date) => { now = when; },
    play: (results: ReadonlyMap<number, GameResult>) => {
      games.putMatches(withResults([...games.matches.values()], results));
    },
    /** A game the results feed has marked under way, whatever its scheduled time says. */
    markUnderWay: (matchNumber: number) => {
      const match = expectDefined([...games.matches.values()].find((each) => each.matchNumber === matchNumber));
      games.putMatches([{ ...match, status: MatchStatus.IN_PROGRESS }]);
    },
  };
}

async function expectRefused(promise: Promise<unknown>, code: string, statusCode?: number): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  if (!(error instanceof Error)) throw new Error(`expected a refusal ${code}, got ${String(error)}`);
  expect(error).toMatchObject({ code, ...(statusCode !== undefined && { statusCode }) });
}

const game = (view: GamePicksView, matchNumber: number) => expectDefined(view.games.find((each) => each.match.matchNumber === matchNumber));
const predicted = (view: GamePicksView, matchNumber: number) => {
  const each = game(view, matchNumber);
  return [each.predictedHome?.sportEventParticipantId ?? null, each.predictedAway?.sportEventParticipantId ?? null];
};

describe('a second-chance bracket — the games it picks', () => {
  it('offers only the games from its starting round on, the starting round with the teams the results put there', async () => {
    const context = setup();

    const view = await context.predictions.getGamePicks(context.input);

    expect(view.gameCount).toBe(3);
    expect(view.games.map((each) => each.match.matchNumber)).toEqual([5, 6, 7]);
    expect(predicted(view, 5)).toEqual(['T1', 'T5']);
    expect(predicted(view, 6)).toEqual(['T2', 'T3']);
    expect(predicted(view, 7)).toEqual([null, null]);
  });

  it('refuses a pick on a game before its starting round with 404 PREDICTION_GAME_NOT_FOUND, saving nothing', async () => {
    const context = setup();

    await expectRefused(
      context.predictions.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(1, 'T1'), confidence: null }] }),
      'PREDICTION_GAME_NOT_FOUND', 404,
    );
    expect(context.games.predictions.size).toBe(0);
  });
});

describe('a second-chance bracket — open while the event is under way, until its starting round', () => {
  it('saves picks and the tiebreaker and submits on an IN_PROGRESS event before the starting round\'s first game', async () => {
    const context = setup();

    const ready = await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    expect(ready).toMatchObject({ pickedCount: 3, tiebreakerValue: 140, canSubmit: true });
    expect(game(ready, 5).locked).toBe(false);
    expect(predicted(ready, 7)).toEqual(['T1', 'T2']);

    const submitted = await context.predictions.submitGamePicks(context.input);
    expect(submitted.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(context.status()).toBe(ContestEntryStatus.SUBMITTED);
    // Its picks close with its starting round, not at the event's start two days ago.
    expect(submitted.picksCloseAt).toEqual(ROUND_TWO_FIRST_GAME);
  });

  it('locks every pick with 409 PREDICTION_GAME_STARTED and the tiebreaker with 409 CONTEST_ENTRY_LOCKED once the starting round\'s first game time passes', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    await context.predictions.submitGamePicks(context.input);
    context.setNow(at(2.5));

    // The final is two days away, but a bracket's picks all close with its starting round.
    await expectRefused(
      context.predictions.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(7, 'T2'), confidence: null }] }),
      'PREDICTION_GAME_STARTED', 409,
    );
    await expectRefused(context.predictions.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 150 }), 'CONTEST_ENTRY_LOCKED', 409);
    const view = await context.predictions.getGamePicks(context.input);
    expect(view.games.every((each) => each.locked)).toBe(true);
    expect(view.tiebreakerValue).toBe(140);
  });

  it('refuses to submit a draft with 409 CONTEST_ENTRY_LOCKED once the starting round\'s first game is marked under way, though its time has not come', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    context.markUnderWay(5);

    await expectRefused(context.predictions.submitGamePicks(context.input), 'CONTEST_ENTRY_LOCKED', 409);
    expect(context.status()).toBe(ContestEntryStatus.DRAFT);
    expect((await context.predictions.getGamePicks(context.input)).canSubmit).toBe(false);
  });

  it('still locks a full bracket on the same in-progress event: a draft that missed the event\'s start is refused with 409 CONTEST_ENTRY_LOCKED', async () => {
    const context = setup({ startsAtRound: 1 });

    const view = await context.predictions.getGamePicks(context.input);

    expect(view.gameCount).toBe(7);
    expect(view.games.every((each) => each.locked)).toBe(true);
    await expectRefused(
      context.predictions.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(5, 'T1'), confidence: null }] }),
      'CONTEST_ENTRY_LOCKED', 409,
    );
  });
});

describe('a second-chance bracket — who sees its picks', () => {
  it('hides the entry\'s picks and tiebreaker from another team while the event is under way, before the starting round', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    await context.predictions.submitGamePicks(context.input);

    const view = await context.predictions.getGamePicks({ ...context.input, actorUserId: context.bob.id });

    expect(view.ownEntry).toBe(false);
    expect(view.games.every((each) => each.pick === null && !each.revealed)).toBe(true);
    expect(predicted(view, 7)).toEqual([null, null]);
    expect(view).toMatchObject({ pickedCount: 0, tiebreakerValue: null, points: null });
  });

  it('reveals them, and scores the starting round at its own round value, once the contest is live past the starting round\'s first game', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    await context.predictions.submitGamePicks(context.input);
    context.setNow(at(3));
    await context.lifecycle.activateContestsPastCutoff(context.eventNow(), at(3));
    context.play(new Map([[5, { winner: HOME, homeScore: 70, awayScore: 61 }]]));

    const view = await context.predictions.getGamePicks({ ...context.input, actorUserId: context.bob.id });

    expect(view.pickedCount).toBe(3);
    expect(view.tiebreakerValue).toBe(140);
    expect(predicted(view, 7)).toEqual(['T1', 'T2']);
    // Game 5 is a round-2 game: worth 2, and T2 and T1 can still earn 2 and 4.
    expect(game(view, 5).pickScore).toEqual({ outcome: PickOutcome.CORRECT, points: 2 });
    expect(view).toMatchObject({ points: 2, maxPossiblePoints: 8 });
  });
});

describe('a second-chance bracket — entering it', () => {
  it('lets a member enter while the event is under way, before the starting round\'s first game', async () => {
    const context = setup();

    const created = await context.contests.createEntry(context.contest.id, context.bob.id);

    expect(created).toMatchObject({ contestId: context.contest.id });
    expect(context.world.entriesOf(context.contest.id, expectDefined([...context.world.squads.values()].find((squad) => squad.name === 'Bob United')).id)).toHaveLength(1);
  });

  it('refuses a new entry with CONTEST_ENTRY_LOCKED once the starting round\'s first game time passes, entering nobody', async () => {
    const context = setup();
    context.setNow(at(2.5));

    await expectRefused(context.contests.createEntry(context.contest.id, context.bob.id), 'CONTEST_ENTRY_LOCKED');
    expect([...context.world.entries.values()].map((each) => each.id)).toEqual(['entry-alice']);
  });

  it('refuses a new entry to a full bracket on the same in-progress event with CONTEST_ENTRY_LOCKED', async () => {
    const context = setup({ startsAtRound: 1 });

    await expectRefused(context.contests.createEntry(context.contest.id, context.bob.id), 'CONTEST_ENTRY_LOCKED');
  });
});

describe('a second-chance bracket — its leaderboard and standings', () => {
  it('refuses the bracket leaderboard with CONTEST_LEADERBOARD_PICKS_HIDDEN while the event is under way, before the starting round', async () => {
    const context = setup();

    await expectRefused(context.contests.getBracketLeaderboard(context.contest.id, context.bob.id), 'CONTEST_LEADERBOARD_PICKS_HIDDEN');
  });

  it('refuses it before the starting round\'s first game even on a contest marked live: the reveal waits for the round, not the event\'s start', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contestNow(), status: ContestStatus.ACTIVE });

    await expectRefused(context.contests.getBracketLeaderboard(context.contest.id, context.bob.id), 'CONTEST_LEADERBOARD_PICKS_HIDDEN');
  });

  it('answers it once the starting round has begun, over the three games from that round on', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    await context.predictions.submitGamePicks(context.input);
    context.setNow(at(3));
    await context.lifecycle.activateContestsPastCutoff(context.eventNow(), at(3));

    const leaderboard = await context.contests.getBracketLeaderboard(context.contest.id, context.bob.id);

    expect(leaderboard).toMatchObject({ gameCount: 3, finalTotalPoints: null });
    expect(leaderboard.entries.map((row) => [row.entryName, row.points, row.maxPossiblePoints])).toEqual([['Alice FC', 0, 2 + 2 + 4]]);
  });

  it('scores only the games from the starting round on: a pick stored on a round-1 game earns nothing', async () => {
    const context = setup();
    await context.predictions.saveGamePicks({ ...context.input, picks: ALICE, tiebreakerValue: 140 });
    await context.predictions.submitGamePicks(context.input);
    // A pick on game 1, which T1 won: a full bracket would score it, a second-chance one must not.
    context.games.predictions.set('entry-alice:m1', {
      id: 'prediction-entry-alice-m1', contestEntryId: 'entry-alice', sportEventMatchId: 'm1',
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: 'T1', confidence: null, pickedAt: T0, createdAt: T0, updatedAt: T0,
    });
    context.play(new Map<number, GameResult>([
      [5, { winner: HOME }],
      [6, { winner: AWAY }],
      [7, { home: 'T1', away: 'T3', winner: HOME, homeScore: 70, awayScore: 66 }],
    ]));

    const standings = await loadBracketStandings(context.deps, context.contest.id, context.eventNow());

    // T1 in game 5 (2) and the final (4); T2 lost game 6.
    expect(standings).toMatchObject({ gameCount: 3, finalTotalPoints: 136 });
    expect(standings.entries.map((standing) => [standing.entry.name, standing.score.points, standing.score.correctPickCount, standing.score.decidedPickCount]))
      .toEqual([['Alice FC', 6, 2, 3]]);
  });
});

describe('a second-chance bracket — going live', () => {
  it('stays OPEN when its event moves to IN_PROGRESS, while an ordinary contest on the event goes live at the event\'s start', async () => {
    const context = setup();
    context.world.sportEvents.set(context.sportEvent.id, { ...context.eventNow(), status: SportEventStatus.SCHEDULED });
    const ordinary = context.world.addContest(context.contest.leagueId, { status: ContestStatus.OPEN, sportEventIds: [context.sportEvent.id] });
    context.world.addConfiguration(ordinary.id);

    await context.lifecycle.applySportEventStatusTransition({
      sportEventId: context.sportEvent.id, toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'SYSTEM' },
    });

    expect(expectDefined(context.world.contests.get(ordinary.id))).toMatchObject({ status: ContestStatus.ACTIVE, startsAt: at(-48) });
    expect(context.contestNow().status).toBe(ContestStatus.OPEN);
  });

  it('is left OPEN by a sweep before its starting round\'s first game', async () => {
    const context = setup();

    await context.lifecycle.activateContestsPastCutoff(context.eventNow(), at(1));

    expect(context.contestNow().status).toBe(ContestStatus.OPEN);
    expect(context.contestNow().startsAt).toBeUndefined();
  });

  it('goes live on the first sweep past its starting round\'s first game, starting at that game\'s time', async () => {
    const context = setup();

    await context.lifecycle.activateContestsPastCutoff(context.eventNow(), at(2.1));

    expect(context.contestNow()).toMatchObject({ status: ContestStatus.ACTIVE, startsAt: ROUND_TWO_FIRST_GAME });
  });

  it('goes live once a game of its starting round is marked under way, before the game\'s scheduled time', async () => {
    const context = setup();
    context.markUnderWay(6);

    await context.lifecycle.activateContestsPastCutoff(context.eventNow(), at(1));

    expect(context.contestNow()).toMatchObject({ status: ContestStatus.ACTIVE, startsAt: ROUND_TWO_FIRST_GAME });
  });
});
