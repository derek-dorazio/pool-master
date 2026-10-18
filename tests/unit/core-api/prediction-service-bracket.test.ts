/**
 * PredictionService on a bracket contest (#721): one entry fills in an eight-team knockout before
 * it starts — later games offer the teams its own picks sent there, a changed pick clears the
 * picks that followed from it, the tiebreaker rides with the picks and is needed to submit — and
 * once the event is under way its picks are scored and revealed. Against an in-memory world, so
 * each test asserts the stored picks, the entry's status and the view rather than the calls.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  PickOutcome,
  SelectionType,
  UpsetBonusRule,
  contestEntryEventStatus,
  type ContestEntry,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { PredictionService, type GamePicksView } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import {
  EIGHT_SEEDS,
  NFL_SEEDS,
  bracketPick,
  eightTeamBracket,
  knockoutScoringRule,
  nflPlayoff,
  withResults,
  type GameResult,
} from '../../support/bracket-fixtures';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeParticipantContestScoringRuleRepo } from '../../support/repo-fakes';

const HOUR = 60 * 60 * 1000;
/** The test's clock starts two hours before the bracket's first tip-off. */
const NOW = new Date('2027-03-18T14:00:00.000Z');
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);
const T0 = new Date('2027-03-01T00:00:00.000Z');

/** Every game picked to the better seed: T1 wins it all. */
const CHALK = [
  bracketPick(1, 'T1'), bracketPick(2, 'T4'), bracketPick(3, 'T2'), bracketPick(4, 'T3'),
  bracketPick(5, 'T1'), bracketPick(6, 'T2'), bracketPick(7, 'T1'),
].map((each) => ({ ...each, confidence: null }));

function setup(options: { bracket?: SportEventMatch[]; seeds?: ReadonlyMap<string, number | null> } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const alice = world.addUser({ email: 'alice@example.com' });
  const bob = world.addUser({ email: 'bob@example.com' });
  const aliceSquad = world.addSquad(league.id, 'Alice FC');
  const bobSquad = world.addSquad(league.id, 'Bob United');
  world.addSquadMember(aliceSquad.id, alice.id);
  world.addSquadMember(bobSquad.id, bob.id);

  const sportEvent = world.addSportEvent({ name: 'Regional', startDate: at(2) });
  games.addBracket(
    (options.bracket ?? eightTeamBracket()).map((match) => ({ ...match, sportEventId: sportEvent.id })),
    options.seeds ?? EIGHT_SEEDS,
  );
  const contest = world.addContest(league.id, {
    name: 'Bracket pool',
    status: ContestStatus.OPEN,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.BRACKET,
    sportEventIds: [sportEvent.id],
  });
  const configuration = world.addConfiguration(contest.id, {
    selectionType: SelectionType.BRACKET,
    configJson: { selectionType: SelectionType.BRACKET },
  });
  const rules = [knockoutScoringRule(configuration.id, {
    roundValues: [1, 2, 4, 8],
    upsetBonus: { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 1 },
  })];
  const aliceEntry: ContestEntry = {
    id: 'entry-alice', contestId: contest.id, squadId: aliceSquad.id, entryNumber: 1, name: 'Alice FC',
    events: [{ sportEventId: sportEvent.id, status: ContestEntryStatus.DRAFT }], createdAt: T0, updatedAt: T0,
  };
  world.entries.set(aliceEntry.id, aliceEntry);

  let now = NOW;
  const service = new PredictionService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    scoringRules: fakeParticipantContestScoringRuleRepo({ findByContestConfiguration: jest.fn().mockResolvedValue(rules) }),
    entries: world.entryRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: world.sportEventRepo(),
    matches: games.matchRepo(),
    field: games.fieldRepo(),
    participants: games.participantRepo(),
    predictions: games.predictionRepo(),
    now: () => now,
  });

  const input = { contestId: contest.id, entryId: aliceEntry.id, sportEventId: sportEvent.id, actorUserId: alice.id };
  const entry = () => expectDefined(world.entries.get(aliceEntry.id));
  return {
    world, games, service, input, alice, bob, contest,
    status: () => contestEntryEventStatus(entry(), sportEvent.id),
    tiebreaker: () => entry().tiebreakerValue,
    storedPicks: () => [...games.predictions.values()]
      .map((row) => [row.sportEventMatchId, row.sportEventParticipantId] as const)
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true })),
    setNow: (when: Date) => { now = when; },
    goLive: () => {
      now = at(3);
      world.contests.set(contest.id, { ...expectDefined(world.contests.get(contest.id)), status: ContestStatus.ACTIVE });
    },
    playGames: (results: ReadonlyMap<number, GameResult>) => {
      games.putMatches(withResults([...games.matches.values()], results));
    },
  };
}

async function expectRefused(promise: Promise<unknown>, code: string, statusCode: number): Promise<SelectionError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  if (!(error instanceof SelectionError)) throw new Error(`expected a SelectionError ${code}, got ${String(error)}`);
  expect(error).toMatchObject({ code, statusCode });
  return error;
}

const game = (view: GamePicksView, matchNumber: number) => expectDefined(view.games.find((each) => each.match.matchNumber === matchNumber));
const predicted = (view: GamePicksView, matchNumber: number) => {
  const each = game(view, matchNumber);
  return [each.predictedHome?.sportEventParticipantId ?? null, each.predictedAway?.sportEventParticipantId ?? null];
};

describe('PredictionService on a bracket — filling it in', () => {
  it('reads a fresh bracket as BRACKET with no mode, the first round\'s real teams and the later games still to be decided', async () => {
    const context = setup();
    const view = await context.service.getGamePicks(context.input);

    expect(view).toMatchObject({ selectionType: SelectionType.BRACKET, mode: null, gameCount: 7, pickedCount: 0, tiebreakerValue: null, canSubmit: false });
    expect(predicted(view, 1)).toEqual(['T1', 'T8']);
    expect(predicted(view, 5)).toEqual([null, null]);
    expect(game(view, 5).home).toBeNull();
  });

  it('saves picks through to the final in one request, each later game offering the teams picked to win the games before it', async () => {
    const context = setup();
    const view = await context.service.saveGamePicks({ ...context.input, picks: CHALK });

    expect(context.storedPicks()).toEqual(CHALK.map((each) => [each.sportEventMatchId, each.sportEventParticipantId]));
    expect(predicted(view, 5)).toEqual(['T1', 'T4']);
    expect(predicted(view, 7)).toEqual(['T1', 'T2']);
    expect(view.pickedCount).toBe(7);
  });

  it('refuses a later pick naming a team the entry did not pick to get there with 400 PREDICTION_TEAM_NOT_IN_GAME, saving none of the request', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(1, 'T1'), confidence: null }, { ...bracketPick(5, 'T8'), confidence: null }] }),
      'PREDICTION_TEAM_NOT_IN_GAME', 400,
    );
    expect(context.storedPicks()).toEqual([]);
  });

  it('refuses a confidence value on a bracket pick with 409 PREDICTION_CONFIDENCE_INVALID', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(1, 'T1'), confidence: 1 }] }),
      'PREDICTION_CONFIDENCE_INVALID', 409,
    );
  });

  it('clears the picks of the two later rounds that followed from a changed first-round pick, in the same save', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK });

    const view = await context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(1, 'T8'), confidence: null }] });

    expect(context.storedPicks()).toEqual([['m1', 'T8'], ['m2', 'T4'], ['m3', 'T2'], ['m4', 'T3'], ['m6', 'T2']]);
    expect(predicted(view, 5)).toEqual(['T8', 'T4']);
    expect(predicted(view, 7)).toEqual([null, 'T2']);
  });

  it('keeps the later picks a changed pick does not touch', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK });

    // T4 to T5 in game 2 changes who T1 meets in game 5, not that T1 is picked to win it.
    await context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(2, 'T5'), confidence: null }] });

    expect(context.storedPicks()).toEqual([['m1', 'T1'], ['m2', 'T5'], ['m3', 'T2'], ['m4', 'T3'], ['m5', 'T1'], ['m6', 'T2'], ['m7', 'T1']]);
  });

  it('clears the picks that followed from a cleared pick', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK });

    await context.service.clearGamePick({ ...context.input, sportEventMatchId: 'm3' });

    // Game 6 offered T2 only through game 3; the final still offers T1 through game 5.
    expect(context.storedPicks()).toEqual([['m1', 'T1'], ['m2', 'T4'], ['m4', 'T3'], ['m5', 'T1'], ['m7', 'T1']]);
  });

  it('pairs a reseeded round from the entry\'s own Wild Card picks, as the NFL\'s Divisional round is', async () => {
    const context = setup({ bracket: nflPlayoff(), seeds: NFL_SEEDS });
    const wildCard = [bracketPick(1, 'AFC-7'), bracketPick(2, 'AFC-3'), bracketPick(3, 'AFC-5'), bracketPick(4, 'NFC-2'), bracketPick(5, 'NFC-3'), bracketPick(6, 'NFC-4')];

    const view = await context.service.saveGamePicks({ ...context.input, picks: wildCard.map((each) => ({ ...each, confidence: null })) });

    expect(predicted(view, 7)).toEqual(['AFC-1', 'AFC-7']);
    expect(predicted(view, 8)).toEqual(['AFC-3', 'AFC-5']);
    expect(predicted(view, 10)).toEqual(['NFC-2', 'NFC-3']);
  });
});

describe('PredictionService on a bracket — the tiebreaker and submitting', () => {
  it('saves the tiebreaker with the picks onto the entry and shows it to the owner', async () => {
    const context = setup();
    const view = await context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 141 });

    expect(context.tiebreaker()).toBe(141);
    expect(view.tiebreakerValue).toBe(141);
  });

  it('leaves the tiebreaker as it is when a save does not mention it, and clears it when the save sends null', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 141 });

    await context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(1, 'T1'), confidence: null }] });
    expect(context.tiebreaker()).toBe(141);

    await context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: null });
    expect(context.tiebreaker()).toBeNull();
  });

  it('refuses to submit a fully picked bracket without a tiebreaker with 409 PREDICTION_TIEBREAKER_MISSING, leaving it in draft', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK });

    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_TIEBREAKER_MISSING', 409);
    expect(context.status()).toBe(ContestEntryStatus.DRAFT);
  });

  it('refuses to submit a bracket with a game unpicked with 409 PREDICTION_WEEK_INCOMPLETE, before the missing tiebreaker', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK.slice(0, 6) });

    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_WEEK_INCOMPLETE', 409);
  });

  it('submits a bracket with every game picked and a tiebreaker, which it reports it can until then', async () => {
    const context = setup();
    const ready = await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    expect(ready.canSubmit).toBe(true);

    const view = await context.service.submitGamePicks(context.input);
    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(view.canSubmit).toBe(false);
  });

  it('sends a submitted bracket back to DRAFT when a changed pick clears the picks after it', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);

    // T7 over T2 in game 3 strands the pick of T2 in game 6.
    await context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(3, 'T7'), confidence: null }] });

    expect(context.status()).toBe(ContestEntryStatus.DRAFT);
    expect(context.storedPicks().map(([matchId]) => matchId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm7']);
  });

  it('sends a submitted bracket back to DRAFT when its tiebreaker is taken away', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);

    await context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: null });

    expect(context.status()).toBe(ContestEntryStatus.DRAFT);
  });

  it('refuses a tiebreaker change once the event has started with 409 CONTEST_ENTRY_LOCKED, keeping the one given', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);
    context.goLive();

    const error = await expectRefused(context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 150 }), 'CONTEST_ENTRY_LOCKED', 409);
    expect(error.message).toMatch(/tiebreaker/);
    expect(context.tiebreaker()).toBe(140);
  });

  it('refuses a pick on a later game once the event has started with 409 PREDICTION_GAME_STARTED: every bracket pick locks at the start', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);
    context.goLive();

    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [{ ...bracketPick(7, 'T2'), confidence: null }] }),
      'PREDICTION_GAME_STARTED', 409,
    );
  });
});

describe('PredictionService on a bracket — what each viewer sees, and the score', () => {
  it('shows another team only the games\' real teams, no picks, points or tiebreaker before the event starts', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });

    const view = await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id });

    expect(view.ownEntry).toBe(false);
    expect(view.games.every((each) => each.pick === null)).toBe(true);
    expect(predicted(view, 5)).toEqual([null, null]);
    expect(view).toMatchObject({ tiebreakerValue: null, points: null, maxPossiblePoints: null, pickedCount: 0 });
  });

  it('reveals the entry\'s picks, predicted games and tiebreaker to another team once the event has started', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: CHALK, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);
    context.goLive();

    const view = await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id });

    expect(view.pickedCount).toBe(7);
    expect(predicted(view, 7)).toEqual(['T1', 'T2']);
    expect(view.tiebreakerValue).toBe(140);
    expect(view).toMatchObject({ points: 0, maxPossiblePoints: 1 * 4 + 2 * 2 + 4 });
  });

  it('scores each pick against the results: correct with its points and upset bonus, busted, or still pending', async () => {
    const context = setup();
    // Alice has T5 upsetting T4, and T2 through game 6; T2 loses in round 1.
    const picks = CHALK.map((each) => (each.sportEventMatchId === 'm2' ? { ...each, sportEventParticipantId: 'T5' } : each));
    await context.service.saveGamePicks({ ...context.input, picks, tiebreakerValue: 140 });
    await context.service.submitGamePicks(context.input);
    context.goLive();
    context.playGames(new Map([
      [1, { winner: MatchSide.HOME }], [2, { winner: MatchSide.AWAY }], [3, { winner: MatchSide.AWAY }], [4, { winner: MatchSide.HOME }],
    ]));

    const view = await context.service.getGamePicks(context.input);

    expect(game(view, 2).pickScore).toEqual({ outcome: PickOutcome.CORRECT, points: 1 + (5 - 4) });
    expect(game(view, 3).pickScore).toEqual({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(game(view, 5).pickScore).toEqual({ outcome: PickOutcome.PENDING, points: null });
    expect(game(view, 6).pickScore).toEqual({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(game(view, 7).pickScore).toEqual({ outcome: PickOutcome.PENDING, points: null });
    // 1 + 2 + 1 so far, and T1 can still win game 5 (2) and the final (4).
    expect(view).toMatchObject({ points: 4, maxPossiblePoints: 10 });
  });
});
