/**
 * PredictionService (#716): one pick'em entry's week of game picks — saving, clearing,
 * submitting, and what another team sees — against an in-memory world, so each test asserts the
 * stored picks and the week's status rather than the calls that wrote them.
 */
import { expect } from '@jest/globals';
import type { ContestEntryMatchPredictionWrite } from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchStatus,
  PickEmMode,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  contestEntryEventStatus,
  getSportDefinition,
  type ContestEntry,
  type Sport,
  type SportDefinition,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';

const HOUR = 60 * 60 * 1000;
/** The test's clock starts two hours before the week's first kickoff. */
const NOW = new Date('2026-09-10T20:00:00.000Z');
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);
const T0 = new Date('2026-09-01T00:00:00.000Z');

/** The world's sport, as a sport whose pick'em pools offer tie picks (soccer's draw, #792) reads it. */
const offeringTiePicks = (sport: Sport): SportDefinition => ({ ...getSportDefinition(sport), pickEm: { tiePicks: true, againstTheSpread: false } });

function setup(options: { mode?: PickEmMode; contestStatus?: ContestStatus; selectionType?: SelectionType; tiePicks?: boolean } = {}) {
  const world = new InMemoryContestWorld();
  const week = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const alice = world.addUser({ email: 'alice@example.com' });
  const bob = world.addUser({ email: 'bob@example.com' });
  const aliceSquad = world.addSquad(league.id, 'Alice FC');
  const bobSquad = world.addSquad(league.id, 'Bob United');
  world.addSquadMember(aliceSquad.id, alice.id);
  world.addSquadMember(bobSquad.id, bob.id);

  // The week's event starts at its first kickoff, two hours from now.
  const sportEvent = world.addSportEvent({ name: 'Week 1', startDate: at(2) });
  const otherEvent = world.addSportEvent({ name: 'Week 2', startDate: at(170) });
  const thursday = week.addGame(sportEvent.id, 1, at(2));
  const sunday = week.addGame(sportEvent.id, 2, at(50));
  const monday = week.addGame(sportEvent.id, 3, null);
  const cancelled = week.addGame(sportEvent.id, 4, at(50), MatchStatus.CANCELLED);
  const otherWeekGame = week.addGame(otherEvent.id, 5, at(170));

  const selectionType = options.selectionType ?? SelectionType.PICK_EM;
  const mode = options.mode ?? PickEmMode.CONFIDENCE;
  const contest = world.addContest(league.id, {
    name: 'Confidence pool',
    status: options.contestStatus ?? ContestStatus.OPEN,
    contestFormat: selectionType === SelectionType.PICK_EM ? ContestFormat.PREDICTION : ContestFormat.ROSTER,
    selectionType,
    sportEventIds: [sportEvent.id],
  });
  world.addConfiguration(contest.id, selectionType === SelectionType.PICK_EM
    ? { selectionType, configJson: { selectionType: SelectionType.PICK_EM, mode, againstTheSpread: false } }
    : {});
  const aliceEntry: ContestEntry = {
    id: 'entry-alice', contestId: contest.id, squadId: aliceSquad.id, entryNumber: 1, name: 'Alice FC',
    events: [{ sportEventId: sportEvent.id, status: ContestEntryStatus.DRAFT }], createdAt: T0, updatedAt: T0,
  };
  world.entries.set(aliceEntry.id, aliceEntry);

  let now = NOW;
  const service = new PredictionService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    scoringRules: world.scoringRuleRepo(),
    entries: world.entryRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: world.sportEventRepo(),
    matches: week.matchRepo(),
    field: week.fieldRepo(),
    participants: week.participantRepo(),
    predictions: week.predictionRepo(),
    ...(options.tiePicks ? { sportDefinitionOf: offeringTiePicks } : {}),
    now: () => now,
  });

  const input = { contestId: contest.id, entryId: aliceEntry.id, sportEventId: sportEvent.id, actorUserId: alice.id };
  const pick = (game: SportEventMatch, confidence: number | null, side: 'home' | 'away' = 'home'): ContestEntryMatchPredictionWrite => ({
    sportEventMatchId: game.id,
    predictedResult: PredictedResult.TEAM,
    sportEventParticipantId: expectDefined(side === 'home' ? game.homeSportEventParticipantId : game.awaySportEventParticipantId),
    confidence,
  });
  const tiePick = (game: SportEventMatch, confidence: number | null): ContestEntryMatchPredictionWrite => ({
    sportEventMatchId: game.id,
    predictedResult: PredictedResult.TIE,
    sportEventParticipantId: null,
    confidence,
  });

  return {
    world, week, service, contest, sportEvent, otherEvent, alice, bob, input, pick, tiePick,
    games: { thursday, sunday, monday, cancelled, otherWeekGame },
    weekStatus: () => contestEntryEventStatus(expectDefined(world.entries.get(aliceEntry.id)), sportEvent.id),
    submittedAt: () => expectDefined(world.entries.get(aliceEntry.id)).events
      .find((row) => row.sportEventId === sportEvent.id)?.submittedAt,
    storedPicks: () => [...week.predictions.values()]
      .map((row) => [row.sportEventMatchId, row.sportEventParticipantId, row.confidence] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
    setNow: (when: Date) => { now = when; },
    setContestStatus: (status: ContestStatus) => {
      world.contests.set(contest.id, { ...expectDefined(world.contests.get(contest.id)), status });
    },
    setEventStatus: (status: SportEventStatus) => {
      world.sportEvents.set(sportEvent.id, { ...expectDefined(world.sportEvents.get(sportEvent.id)), status } as SportEvent);
    },
  };
}

async function expectRefused(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SelectionError);
  expect(error).toMatchObject({ code, statusCode });
}

/** Saves a full, valid confidence week for Alice, with its tiebreaker, and submits it. */
async function submitFullWeek(context: ReturnType<typeof setup>) {
  const { service, input, pick, games } = context;
  await service.saveGamePicks({ ...input, picks: [pick(games.thursday, 3), pick(games.sunday, 2), pick(games.monday, 1)], tiebreakerValue: 41 });
  return service.submitGamePicks(input);
}

describe('PredictionService.saveGamePicks — what a save is refused for', () => {
  it('saves picks on the week\'s games and reports how many of its games are picked', async () => {
    const context = setup();
    const view = await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, 1, 'away')],
    });

    expect(view.pickedCount).toBe(2);
    expect(view.gameCount).toBe(3);
    expect(view.status).toBe(ContestEntryStatus.DRAFT);
    expect(context.storedPicks()).toEqual([
      ['game-1', context.games.thursday.homeSportEventParticipantId, 3],
      ['game-2', context.games.sunday.awaySportEventParticipantId, 1],
    ]);
  });

  it('refuses a save with no signed-in user with 401 AUTH_SESSION_REQUIRED', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, actorUserId: undefined, picks: [context.pick(context.games.sunday, 1)] }),
      'AUTH_SESSION_REQUIRED', 401,
    );
  });

  it('refuses another team\'s member saving the entry\'s picks with 403 ENTRY_ACCESS_DENIED', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, actorUserId: context.bob.id, picks: [context.pick(context.games.sunday, 1)] }),
      'ENTRY_ACCESS_DENIED', 403,
    );
    expect(context.storedPicks()).toEqual([]);
  });

  it('refuses game picks on a roster contest with 409 CONTEST_FORMAT_MISMATCH', async () => {
    const context = setup({ selectionType: SelectionType.TIERED });
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)] }),
      'CONTEST_FORMAT_MISMATCH', 409,
    );
  });

  it('refuses an event the contest does not cover with 404 CONTEST_EVENT_NOT_IN_CONTEST', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, sportEventId: context.otherEvent.id, picks: [context.pick(context.games.otherWeekGame, 1)] }),
      'CONTEST_EVENT_NOT_IN_CONTEST', 404,
    );
  });

  it('refuses an entry of another contest with 404 CONTEST_ENTRY_NOT_FOUND', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, entryId: 'entry-elsewhere', picks: [context.pick(context.games.sunday, 1)] }),
      'CONTEST_ENTRY_NOT_FOUND', 404,
    );
  });

  it.each([ContestStatus.DRAFT, ContestStatus.COMPLETED])(
    'refuses a save on a %s contest with 409 CONTEST_ENTRY_LOCKED',
    async (status) => {
      const context = setup({ contestStatus: status });
      await expectRefused(
        context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)] }),
        'CONTEST_ENTRY_LOCKED', 409,
      );
    },
  );

  it('refuses a game of another week, and a cancelled game, with 404 PREDICTION_GAME_NOT_FOUND', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.otherWeekGame, 1)] }),
      'PREDICTION_GAME_NOT_FOUND', 404,
    );
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.cancelled, 1)] }),
      'PREDICTION_GAME_NOT_FOUND', 404,
    );
  });

  it('refuses a game that has kicked off with 409 PREDICTION_GAME_STARTED, before checking the team picked', async () => {
    const context = setup();
    await submitFullWeek(context);
    context.setNow(at(3));
    context.setContestStatus(ContestStatus.ACTIVE);

    await expectRefused(
      context.service.saveGamePicks({
        ...context.input,
        picks: [{ sportEventMatchId: context.games.thursday.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'field-not-playing', confidence: 3 }],
      }),
      'PREDICTION_GAME_STARTED', 409,
    );
  });

  it('refuses a team not playing in the game with 400 PREDICTION_TEAM_NOT_IN_GAME, before checking its confidence', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({
        ...context.input,
        picks: [{ sportEventMatchId: context.games.sunday.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: context.games.thursday.homeSportEventParticipantId ?? '', confidence: 99 }],
      }),
      'PREDICTION_TEAM_NOT_IN_GAME', 400,
    );
  });

  it.each([0, 4])('refuses confidence %p in a three-game confidence week with 409 PREDICTION_CONFIDENCE_INVALID', async (confidence) => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, confidence)] }),
      'PREDICTION_CONFIDENCE_INVALID', 409,
    );
  });

  it('saves a pick\'em week\'s tiebreaker on the entry\'s row for the week, naming the week\'s last game by kickoff as its game', async () => {
    const context = setup();
    const view = await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)], tiebreakerValue: 45 });

    // Sunday's game kicks off last: the Monday game has no time of its own, so it kicks off at the event's start.
    expect(view).toMatchObject({ tiebreakerValue: 45, tiebreakerMatchId: context.games.sunday.id });
    expect(expectDefined(context.world.entries.get('entry-alice')).events).toContainEqual(expect.objectContaining({ sportEventId: context.sportEvent.id, tiebreakerValue: 45 }));
    expect(expectDefined(context.world.entries.get('entry-alice')).tiebreakerValue).toBeUndefined();
  });

  it('refuses any confidence value in a straight-up pool with 409 PREDICTION_CONFIDENCE_INVALID', async () => {
    const context = setup({ mode: PickEmMode.STRAIGHT_UP });
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)] }),
      'PREDICTION_CONFIDENCE_INVALID', 409,
    );
  });

  it('saves none of a batch when one of its picks is refused', async () => {
    const context = setup();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.thursday, 1), context.pick(context.games.sunday, 7)] }),
      'PREDICTION_CONFIDENCE_INVALID', 409,
    );
    expect(context.storedPicks()).toEqual([]);
  });

  it('allows a repeated confidence value in a draft week, so values can be swapped one pick at a time', async () => {
    const context = setup();
    const view = await context.service.saveGamePicks({
      ...context.input, picks: [context.pick(context.games.thursday, 2), context.pick(context.games.sunday, 2)],
    });
    expect(view.pickedCount).toBe(2);
    expect(view.canSubmit).toBe(false);
  });
});

describe('PredictionService.submitGamePicks — submitting the week', () => {
  it('submits a week with every game picked and confidence 1 to 3 each once, stamping submittedAt', async () => {
    const context = setup();
    const view = await submitFullWeek(context);

    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(view.submittedAt).toEqual(NOW);
    expect(view.canSubmit).toBe(false);
    expect(context.weekStatus()).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('leaves a cancelled game out of the week: three picks complete a week of four games one of which is cancelled', async () => {
    const context = setup();
    const view = await submitFullWeek(context);
    expect(view.gameCount).toBe(3);
    expect(view.games.map((game) => game.match.id)).toEqual(['game-1', 'game-2', 'game-3']);
  });

  it('refuses a week with a game still to pick with 409 PREDICTION_WEEK_INCOMPLETE, leaving it in draft', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, 2)] });

    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_WEEK_INCOMPLETE', 409);
    expect(context.weekStatus()).toBe(ContestEntryStatus.DRAFT);
  });

  it('refuses a week whose confidence values repeat with 409 PREDICTION_CONFIDENCE_INVALID', async () => {
    const context = setup();
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, 3), context.pick(context.games.monday, 1)],
    });

    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_CONFIDENCE_INVALID', 409);
    expect(context.weekStatus()).toBe(ContestEntryStatus.DRAFT);
  });

  it('refuses a confidence week with a pick still carrying no value with 409 PREDICTION_CONFIDENCE_INVALID', async () => {
    const context = setup();
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, null), context.pick(context.games.monday, 1)],
    });

    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_CONFIDENCE_INVALID', 409);
  });

  it('submits a straight-up week whose picks carry no values', async () => {
    const context = setup({ mode: PickEmMode.STRAIGHT_UP });
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, null), context.pick(context.games.sunday, null), context.pick(context.games.monday, null)],
      tiebreakerValue: 38,
    });
    const view = await context.service.submitGamePicks(context.input);
    expect(view.mode).toBe(PickEmMode.STRAIGHT_UP);
    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses a week with every game picked but no tiebreaker with 409 PREDICTION_TIEBREAKER_MISSING, leaving it in draft', async () => {
    const context = setup();
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, 2), context.pick(context.games.monday, 1)],
    });

    expect((await context.service.getGamePicks(context.input)).canSubmit).toBe(false);
    await expectRefused(context.service.submitGamePicks(context.input), 'PREDICTION_TIEBREAKER_MISSING', 409);
    expect(context.weekStatus()).toBe(ContestEntryStatus.DRAFT);
  });

  it('changes nothing when a submitted week is submitted again, keeping its first submittedAt', async () => {
    const context = setup();
    await submitFullWeek(context);
    context.setNow(at(1));

    const view = await context.service.submitGamePicks(context.input);
    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(context.submittedAt()).toEqual(NOW);
  });

  it('refuses submitting a draft week once the first game has kicked off with 409 CONTEST_ENTRY_LOCKED', async () => {
    const context = setup();
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.pick(context.games.sunday, 2), context.pick(context.games.monday, 1)],
    });
    context.setNow(at(2));
    context.setContestStatus(ContestStatus.ACTIVE);

    await expectRefused(context.service.submitGamePicks(context.input), 'CONTEST_ENTRY_LOCKED', 409);
    expect(context.weekStatus()).toBe(ContestEntryStatus.DRAFT);
  });

  it('refuses another team\'s member submitting the entry with 403 ENTRY_ACCESS_DENIED', async () => {
    const context = setup();
    await expectRefused(context.service.submitGamePicks({ ...context.input, actorUserId: context.bob.id }), 'ENTRY_ACCESS_DENIED', 403);
  });
});

describe('PredictionService — a submitted week before the first kickoff', () => {
  it('sends a submitted week back to DRAFT when a pick is cleared, and clears submittedAt', async () => {
    const context = setup();
    await submitFullWeek(context);

    const view = await context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.sunday.id });
    expect(view.status).toBe(ContestEntryStatus.DRAFT);
    expect(view.submittedAt).toBeNull();
    expect(view.pickedCount).toBe(2);
    expect(context.storedPicks().map(([matchId]) => matchId)).toEqual(['game-1', 'game-3']);
  });

  it('sends a submitted week back to DRAFT when a confidence change repeats a value', async () => {
    const context = setup();
    await submitFullWeek(context);

    const view = await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 3)] });
    expect(view.status).toBe(ContestEntryStatus.DRAFT);
    expect(view.canSubmit).toBe(false);
  });

  it('keeps a submitted week submitted when two confidence values are swapped in one save', async () => {
    const context = setup();
    await submitFullWeek(context);

    const view = await context.service.saveGamePicks({
      ...context.input, picks: [context.pick(context.games.thursday, 2), context.pick(context.games.sunday, 3)],
    });
    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('answers clearing a game with no pick with the week unchanged', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.thursday, 3)] });
    const view = await context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.sunday.id });
    expect(view.pickedCount).toBe(1);
  });
});

describe('PredictionService — after the week\'s first kickoff', () => {
  async function kickedOff(eventStatus?: SportEventStatus) {
    const context = setup();
    await submitFullWeek(context);
    context.setContestStatus(ContestStatus.ACTIVE);
    if (eventStatus) {
      context.setEventStatus(eventStatus);
    } else {
      context.setNow(at(3));
    }
    return context;
  }

  it('refuses clearing a pick on a game still to start with 409 PREDICTION_CLEAR_AFTER_FIRST_KICKOFF, keeping the week submitted', async () => {
    const context = await kickedOff();
    await expectRefused(
      context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.sunday.id }),
      'PREDICTION_CLEAR_AFTER_FIRST_KICKOFF', 409,
    );
    expect(context.storedPicks()).toHaveLength(3);
    expect(context.weekStatus()).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses the clear once the event is IN_PROGRESS, though its start time is still to come', async () => {
    const context = await kickedOff(SportEventStatus.IN_PROGRESS);
    await expectRefused(
      context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.sunday.id }),
      'PREDICTION_CLEAR_AFTER_FIRST_KICKOFF', 409,
    );
  });

  it('refuses clearing the game that has kicked off with 409 PREDICTION_GAME_STARTED', async () => {
    const context = await kickedOff();
    await expectRefused(
      context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.thursday.id }),
      'PREDICTION_GAME_STARTED', 409,
    );
  });

  it('swaps a pick on a game still to start to the other team, keeping the week submitted', async () => {
    const context = await kickedOff();
    const view = await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 2, 'away')] });

    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
    expect(context.storedPicks()).toContainEqual(['game-2', context.games.sunday.awaySportEventParticipantId, 2]);
  });

  it('refuses a confidence change that would leave the submitted week invalid with 409 PREDICTION_CONFIDENCE_INVALID', async () => {
    const context = await kickedOff();
    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)] }),
      'PREDICTION_CONFIDENCE_INVALID', 409,
    );
    expect(context.weekStatus()).toBe(ContestEntryStatus.SUBMITTED);
    expect(context.storedPicks()).toContainEqual(['game-2', context.games.sunday.homeSportEventParticipantId, 2]);
  });

  it('refuses a change that leaves a submitted week with a game unpicked with 409 PREDICTION_WEEK_INCOMPLETE, not a confidence error', async () => {
    const context = await kickedOff();
    // The cancelled game is played after all, so the submitted week now has a game without a pick.
    context.week.matches.set(context.games.cancelled.id, { ...context.games.cancelled, status: MatchStatus.SCHEDULED });

    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 2, 'away')] }),
      'PREDICTION_WEEK_INCOMPLETE', 409,
    );
    expect(context.weekStatus()).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('keeps the tiebreaker changeable after the first kickoff until its own game kicks off, then refuses it with 409 CONTEST_ENTRY_LOCKED', async () => {
    const context = await kickedOff();
    const changed = await context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 47 });
    expect(changed).toMatchObject({ tiebreakerValue: 47, status: ContestEntryStatus.SUBMITTED });

    context.setNow(at(51));
    await expectRefused(context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: 30 }), 'CONTEST_ENTRY_LOCKED', 409);
    expect((await context.service.getGamePicks(context.input)).tiebreakerValue).toBe(47);
  });

  it('refuses taking the tiebreaker away from a submitted week after the first kickoff with 409 PREDICTION_TIEBREAKER_MISSING', async () => {
    const context = await kickedOff();
    await expectRefused(context.service.saveGamePicks({ ...context.input, picks: [], tiebreakerValue: null }), 'PREDICTION_TIEBREAKER_MISSING', 409);
    expect(context.weekStatus()).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses any change to a week left in draft at the first kickoff with 409 CONTEST_ENTRY_LOCKED', async () => {
    const context = setup();
    await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, 1)] });
    context.setNow(at(3));
    context.setContestStatus(ContestStatus.ACTIVE);

    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.monday, 2)] }),
      'CONTEST_ENTRY_LOCKED', 409,
    );
    await expectRefused(
      context.service.clearGamePick({ ...context.input, sportEventMatchId: context.games.sunday.id }),
      'CONTEST_ENTRY_LOCKED', 409,
    );
  });
});

describe('PredictionService.getGamePicks — what each viewer sees', () => {
  it('shows the owner every pick of its week before any game starts, and another team none of them', async () => {
    const context = setup();
    await submitFullWeek(context);

    const own = await context.service.getGamePicks(context.input);
    const other = await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id });

    expect(own.ownEntry).toBe(true);
    expect(own.games.map((game) => game.pick?.confidence)).toEqual([3, 2, 1]);
    expect(other.ownEntry).toBe(false);
    expect(other.canSubmit).toBe(false);
    expect(other.games.map((game) => game.pick)).toEqual([null, null, null]);
    expect(other.pickedCount).toBe(0);
  });

  it('reads a pick\'em week as PICK_EM in its mode, each game offering its own two teams, with no points yet and every confidence value still to win', async () => {
    const context = setup();
    await submitFullWeek(context);

    const view = await context.service.getGamePicks(context.input);

    expect(view).toMatchObject({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false, tiebreakerValue: 41, points: 0, maxPossiblePoints: 6 });
    const thursday = expectDefined(view.games.find((game) => game.match.id === context.games.thursday.id));
    expect(thursday.predictedHome).toEqual(thursday.home);
    expect(thursday.predictedAway).toEqual(thursday.away);
    expect(thursday.pickScore).toEqual({ outcome: 'PENDING', points: null });
  });

  it('scores each pick of a confidence week as its game is played: its value when correct, nothing on a loss or a tie', async () => {
    const context = setup();
    await submitFullWeek(context);
    const { thursday, sunday, monday } = context.games;
    context.week.putMatches([
      { ...thursday, status: MatchStatus.COMPLETED, winnerSide: 'HOME', homeScore: 24, awayScore: 17 },
      { ...monday, status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 20, awayScore: 20 },
    ]);

    const view = await context.service.getGamePicks(context.input);
    expect(view).toMatchObject({ points: 3, maxPossiblePoints: 5 });
    expect(view.games.map((game) => [game.match.id, game.pickScore])).toEqual([
      [thursday.id, { outcome: 'CORRECT', points: 3 }],
      [sunday.id, { outcome: 'PENDING', points: null }],
      [monday.id, { outcome: 'BUSTED', points: 0 }],
    ]);
  });

  it('hides another team\'s tiebreaker until its game kicks off, then shows it', async () => {
    const context = setup();
    await submitFullWeek(context);
    context.setContestStatus(ContestStatus.ACTIVE);
    context.setNow(at(3));
    expect((await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id })).tiebreakerValue).toBeNull();

    context.setNow(at(51));
    expect((await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id })).tiebreakerValue).toBe(41);
  });

  it('reveals to another team only the pick of a game that has kicked off once the contest is live', async () => {
    const context = setup();
    await submitFullWeek(context);
    context.setContestStatus(ContestStatus.ACTIVE);
    context.setNow(at(3));

    const other = await context.service.getGamePicks({ ...context.input, actorUserId: context.bob.id });
    expect(other.games.map((game) => [game.match.id, game.revealed, game.locked, game.pick?.confidence ?? null])).toEqual([
      ['game-1', true, true, 3],
      ['game-2', false, false, null],
      // A game with no scheduled time kicks off at the event's start, which has passed.
      ['game-3', true, true, 1],
    ]);
  });

  it('names each game\'s two teams and gives a game with no time its event\'s start as kickoff', async () => {
    const context = setup();
    const view = await context.service.getGamePicks(context.input);
    const monday = expectDefined(view.games.find((game) => game.match.id === 'game-3'));
    expect(monday.kickoff).toEqual(context.sportEvent.startDate);
    expect(monday.home?.name).toBe('Home 3');
    expect(monday.away?.name).toBe('Away 3');
  });
});

describe('PredictionService — tie picks (#792)', () => {
  it('saves a tie pick, naming no team, in a pick\'em pool whose sport offers tie picks, and says the pool takes them', async () => {
    const context = setup({ mode: PickEmMode.STRAIGHT_UP, tiePicks: true });

    const view = await context.service.saveGamePicks({ ...context.input, picks: [context.tiePick(context.games.sunday, null)] });

    expect(view.tiePicksOffered).toBe(true);
    expect(context.storedPicks()).toEqual([['game-2', null, null]]);
    expect(view.games.find((game) => game.match.id === 'game-2')?.pick).toMatchObject({ predictedResult: PredictedResult.TIE, sportEventParticipantId: null });
  });

  it('swaps a team pick for a tie pick on the same game, and back', async () => {
    const context = setup({ mode: PickEmMode.STRAIGHT_UP, tiePicks: true });
    await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, null)] });

    await context.service.saveGamePicks({ ...context.input, picks: [context.tiePick(context.games.sunday, null)] });
    expect(context.storedPicks()).toEqual([['game-2', null, null]]);

    await context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.sunday, null, 'away')] });
    expect(context.storedPicks()).toEqual([['game-2', context.games.sunday.awaySportEventParticipantId, null]]);
  });

  it('submits a confidence week whose picks include a tie, each value used once', async () => {
    const context = setup({ mode: PickEmMode.CONFIDENCE, tiePicks: true });
    await context.service.saveGamePicks({
      ...context.input,
      picks: [context.pick(context.games.thursday, 3), context.tiePick(context.games.sunday, 2), context.pick(context.games.monday, 1)],
      tiebreakerValue: 41,
    });

    const view = await context.service.submitGamePicks(context.input);

    expect(view.status).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('refuses a tie pick with 422 PREDICTION_TIE_NOT_OFFERED where the sport offers none, saving nothing of the batch', async () => {
    const context = setup({ mode: PickEmMode.STRAIGHT_UP });

    await expectRefused(
      context.service.saveGamePicks({ ...context.input, picks: [context.pick(context.games.thursday, null), context.tiePick(context.games.sunday, null)] }),
      'PREDICTION_TIE_NOT_OFFERED',
      422,
    );
    expect(context.storedPicks()).toEqual([]);
    expect((await context.service.getGamePicks(context.input)).tiePicksOffered).toBe(false);
  });
});
