/**
 * A bracket contest's standings (#721), read once for the live bracket leaderboard and for
 * settlement: each submitted entry's standing picks scored against the results, ranked by points
 * and then by how close its tiebreaker came to the final's total. Against the stateful in-memory
 * world, so the tests assert the frozen standings and the leaderboard rows, not the calls.
 *
 * The bracket is eight teams over three rounds worth 1, 2 and 4. Alice and Bob both pick every
 * game to the better seed, T1 winning it all; Alice guesses the final's total at 140, Bob at 120.
 * Cara has T8 upsetting T1 and T4 going on to lose the final to T2. Dan never submits.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  UpsetBonusRule,
  contestEntryEventTiebreaker,
  parseContestScoringSettings,
  type ContestEntry,
  type ParticipantContestScoringRule,
} from '@poolmaster/shared/domain';
import { loadBracketStandings } from '../../../packages/core-api/src/modules/contests/bracket-standings';
import { ContestSettlementService } from '../../../packages/core-api/src/modules/contests/contest-settlement-service';
import {
  ContestEntryOperationError,
  ContestOperationError,
  ContestService,
} from '../../../packages/core-api/src/modules/contests/service';
import {
  EIGHT_SEEDS,
  eightTeamBracket,
  knockoutScoringRule,
  withResults,
  type GameResult,
} from '../../support/bracket-fixtures';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { fakeParticipantContestScoringRuleRepo, fakeSquaresRepo } from '../../support/repo-fakes';

const T0 = new Date('2027-03-01T00:00:00.000Z');
/** The bracket tips off at noon on 18 March; the test's clock is set either side of it. */
const START = new Date('2027-03-18T12:00:00.000Z');
const BEFORE_START = new Date('2027-03-18T10:00:00.000Z');
const DURING = new Date('2027-03-19T12:00:00.000Z');
const SETTLED_AT = new Date('2027-03-21T23:00:00.000Z');

const { HOME, AWAY } = MatchSide;
const ROUND_ONE_CHALK = new Map<number, GameResult>([[1, { winner: HOME }], [2, { winner: HOME }], [3, { winner: HOME }], [4, { winner: HOME }]]);
const ROUND_TWO_CHALK = new Map<number, GameResult>([
  [5, { home: 'T1', away: 'T4', winner: HOME }],
  [6, { home: 'T2', away: 'T3', winner: HOME }],
]);
const FINAL_T1_70_66 = new Map<number, GameResult>([[7, { home: 'T1', away: 'T2', winner: HOME, homeScore: 70, awayScore: 66 }]]);

const CHALK: Array<[number, string]> = [[1, 'T1'], [2, 'T4'], [3, 'T2'], [4, 'T3'], [5, 'T1'], [6, 'T2'], [7, 'T1']];
const CARA: Array<[number, string]> = [[1, 'T8'], [2, 'T4'], [3, 'T2'], [4, 'T3'], [5, 'T4'], [6, 'T2'], [7, 'T2']];

function setup(options: { rules?: (configurationId: string) => ParticipantContestScoringRule[]; contestStatus?: ContestStatus } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const league = world.addLeague();
  const sportEvent = world.addSportEvent({ name: 'Regional', startDate: START });
  games.addBracket(eightTeamBracket(sportEvent.id), EIGHT_SEEDS);
  const contest = world.addContest(league.id, {
    name: 'Bracket pool',
    status: options.contestStatus ?? ContestStatus.ACTIVE,
    contestFormat: ContestFormat.PREDICTION,
    selectionType: SelectionType.BRACKET,
    sportEventIds: [sportEvent.id],
  });
  const configuration = world.addConfiguration(contest.id, {
    selectionType: SelectionType.BRACKET,
    configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 1 },
  });
  const rules = options.rules?.(configuration.id)
    ?? [knockoutScoringRule(configuration.id, { roundValues: [1, 2, 4], upsetBonus: { rule: UpsetBonusRule.NONE } })];

  const viewer = world.addUser({ email: 'viewer@example.com' });
  world.addMember(league.id, viewer.id);

  const enter = (name: string, entryNumber: number, picks: Array<[number, string]>, tiebreakerValue: number | null, submitted = true) => {
    const squad = world.addSquad(league.id, name);
    const entry: ContestEntry = {
      id: `entry-${name.toLowerCase()}`, contestId: contest.id, squadId: squad.id, entryNumber, name,
      events: [{
        sportEventId: sportEvent.id,
        status: submitted ? ContestEntryStatus.SUBMITTED : ContestEntryStatus.DRAFT,
        ...(tiebreakerValue !== null && { tiebreakerValue }),
      }],
      createdAt: T0, updatedAt: T0,
    };
    world.entries.set(entry.id, entry);
    for (const [matchNumber, team] of picks) {
      games.predictions.set(`${entry.id}:m${matchNumber}`, {
        id: `prediction-${entry.id}-m${matchNumber}`, contestEntryId: entry.id, sportEventMatchId: `m${matchNumber}`,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: team, confidence: null, pickedAt: T0, createdAt: T0, updatedAt: T0,
      });
    }
    return entry;
  };
  enter('Alice', 1, CHALK, 140);
  enter('Bob', 1, CHALK, 120);
  enter('Cara', 1, CARA, 150);
  enter('Dan', 1, CHALK, 136, false);

  let now = DURING;
  const deps = world.contestServiceDeps({
    scoringRules: fakeParticipantContestScoringRuleRepo({ findByContestConfiguration: jest.fn().mockResolvedValue(rules) }),
    eventParticipants: games.fieldService(),
    predictions: games.predictionRepo(),
    matches: games.matchRepo(),
    now: () => now,
  });
  const contestService = new ContestService(deps);
  const settlement = new ContestSettlementService({ ...deps, contests: world.contestRepo(), sportEvents: world.sportEventRepo(), squares: fakeSquaresRepo(), championship: { recordContest: async () => 0 } });

  return {
    world, games, contest, sportEvent, viewer, deps, contestService, settlement,
    setNow: (when: Date) => { now = when; },
    play: (...rounds: Array<ReadonlyMap<number, GameResult>>) => {
      for (const results of rounds) games.putMatches(withResults([...games.matches.values()], results));
    },
    completeEvent: () => {
      world.sportEvents.set(sportEvent.id, { ...expectDefined(world.sportEvents.get(sportEvent.id)), status: SportEventStatus.COMPLETED });
    },
  };
}

const rows = (standings: Awaited<ReturnType<typeof loadBracketStandings>>) =>
  standings.entries.map((standing) => [standing.entry.name, standing.score.points, standing.score.maxPossiblePoints, standing.displayPosition]);

describe('loadBracketStandings', () => {
  it('scores only the entries that submitted, sharing a place between level entries while the final is unplayed', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK);

    const standings = await loadBracketStandings(context.deps, context.contest.id, context.sportEvent);

    // Alice and Bob: 4 correct firsts, 2 + 2 + 4 still possible. Cara: T8 busted, T4, T2 and T2 still in.
    expect(rows(standings)).toEqual([
      ['Alice', 4, 12, 'T1'],
      ['Bob', 4, 12, 'T1'],
      ['Cara', 3, 11, '3'],
    ]);
    expect(standings).toMatchObject({ finalTotalPoints: null, gameCount: 7 });
  });

  it('shrinks each entry\'s most possible as its picks bust, round by round', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK);

    const standings = await loadBracketStandings(context.deps, context.contest.id, context.sportEvent);

    // Cara's T4 lost game 5, so her final pick of T2 (worth 4) is all she has left to play for.
    expect(rows(standings)).toEqual([
      ['Alice', 8, 12, 'T1'],
      ['Bob', 8, 12, 'T1'],
      ['Cara', 5, 9, '3'],
    ]);
  });

  it('breaks the tie on points with the tiebreaker closest to the final\'s total once it is played', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK, FINAL_T1_70_66);

    const standings = await loadBracketStandings(context.deps, context.contest.id, context.sportEvent);

    // The final totals 136: Alice's 140 is 4 away, Bob's 120 is 16 away.
    expect(rows(standings)).toEqual([
      ['Alice', 12, 12, '1'],
      ['Bob', 12, 12, '2'],
      ['Cara', 5, 5, '3'],
    ]);
    expect(standings.finalTotalPoints).toBe(136);
    expect(standings.entries[0].score).toMatchObject({ correctPickCount: 7, decidedPickCount: 7 });
  });
});

describe('ContestSettlementService — a bracket contest (#721)', () => {
  it('freezes each submitted entry\'s points and place as its event and contest standing, and completes the contest', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK, FINAL_T1_70_66);
    context.completeEvent();

    const summary = await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    const frozen = [...context.world.standings.values()]
      .map((row) => [row.contestEntryId, row.totalScore, row.position, row.displayPosition, row.scoredPickCount, row.countingPickLimit])
      .sort((left, right) => Number(left[2]) - Number(right[2]));
    expect(frozen).toEqual([
      ['entry-alice', 12, 1, '1', 7, 7],
      ['entry-bob', 12, 2, '2', 7, 7],
      ['entry-cara', 5, 3, '3', 7, 7],
    ]);
    expect([...context.world.eventStandings.values()]
      .sort((left, right) => left.contestEntryId.localeCompare(right.contestEntryId))
      .map((row) => [row.contestEntryId, row.sportEventId, row.totalScore]))
      .toEqual([['entry-alice', context.sportEvent.id, 12], ['entry-bob', context.sportEvent.id, 12], ['entry-cara', context.sportEvent.id, 5]]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
    expect(summary).toEqual({ sportEventId: context.sportEvent.id, contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 3 });
  });

  it('settles nothing for a bracket whose event has not completed', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK);

    const summary = await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    expect(summary.contestsSettled).toBe(0);
    expect(context.world.standings.size).toBe(0);
  });

  it('skips a bracket whose scoring rule is not knockout round points, writing nothing and leaving it ACTIVE', async () => {
    const context = setup({
      rules: (configurationId) => [{
        ...knockoutScoringRule(configurationId, { roundValues: [1], upsetBonus: { rule: UpsetBonusRule.NONE } }),
        scoring: parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', {}),
      }],
    });
    context.completeEvent();

    const summary = await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    expect(summary).toMatchObject({ contestsSettled: 0, standingsUpserted: 0 });
    expect([context.world.standings.size, context.world.eventStandings.size]).toEqual([0, 0]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.ACTIVE);
  });

  it('completes a bracket whose event was cancelled with no standings, whatever results it holds', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK, FINAL_T1_70_66);
    context.world.sportEvents.set(context.sportEvent.id, { ...expectDefined(context.world.sportEvents.get(context.sportEvent.id)), status: SportEventStatus.CANCELLED });

    const summary = await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    expect([context.world.standings.size, context.world.eventStandings.size]).toEqual([0, 0]);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.COMPLETED);
    expect(summary).toMatchObject({ contestsCompleted: 1, standingsUpserted: 0 });
  });

  it('leaves a pick\'em contest on the completed event unsettled and ACTIVE', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contest, selectionType: SelectionType.PICK_EM });
    context.completeEvent();

    const summary = await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    expect(summary.contestsSettled).toBe(0);
    expect(expectDefined(context.world.contests.get(context.contest.id)).status).toBe(ContestStatus.ACTIVE);
  });
});

describe('ContestService.getBracketLeaderboard', () => {
  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => undefined, (caught: unknown) => caught);
  }

  it('refuses the leaderboard before the event starts, while picks are hidden, with CONTEST_LEADERBOARD_PICKS_HIDDEN', async () => {
    const context = setup({ contestStatus: ContestStatus.OPEN });
    context.setNow(BEFORE_START);

    const error = await refusal(context.contestService.getBracketLeaderboard(context.contest.id, context.viewer.id));

    expect(error).toBeInstanceOf(ContestOperationError);
    expect(error).toMatchObject({ code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN' });
  });

  it('refuses a contest that is not a bracket with CONTEST_FORMAT_MISMATCH', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contest, selectionType: SelectionType.PICK_EM });

    const error = await refusal(context.contestService.getBracketLeaderboard(context.contest.id, context.viewer.id));

    expect(error).toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
  });

  it('refuses a bracket with no scoring rule with CONTEST_LEADERBOARD_SCORING_RULE_MISSING, and one not scored by knockout round points with _SCORING_DEFINITION_UNKNOWN', async () => {
    const missing = setup({ rules: () => [] });
    expect(await refusal(missing.contestService.getBracketLeaderboard(missing.contest.id, missing.viewer.id)))
      .toMatchObject({ code: 'CONTEST_LEADERBOARD_SCORING_RULE_MISSING' });

    const golf = setup({
      rules: (configurationId) => [{
        ...knockoutScoringRule(configurationId, { roundValues: [1], upsetBonus: { rule: UpsetBonusRule.NONE } }),
        scoring: parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', {}),
      }],
    });
    expect(await refusal(golf.contestService.getBracketLeaderboard(golf.contest.id, golf.viewer.id)))
      .toMatchObject({ code: 'CONTEST_LEADERBOARD_SCORING_DEFINITION_UNKNOWN' });
  });

  it('answers the live standings once the event is under way: points, most possible, correct picks and tiebreakers', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK);

    const leaderboard = await context.contestService.getBracketLeaderboard(context.contest.id, context.viewer.id);

    expect(leaderboard).toMatchObject({ contestId: context.contest.id, sportEventId: context.sportEvent.id, eventCancelled: false, gameCount: 7, finalTotalPoints: null });
    expect(leaderboard.entries.map((row) => [row.entryName, row.displayPosition, row.points, row.maxPossiblePoints, row.correctPickCount, row.tiebreakerValue])).toEqual([
      ['Alice', 'T1', 8, 12, 6, 140],
      ['Bob', 'T1', 8, 12, 6, 120],
      ['Cara', '3', 5, 9, 4, 150],
    ]);
  });

  it('answers a COMPLETED contest from the standings frozen at settlement, so a later result correction changes no place or points', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK, FINAL_T1_70_66);
    context.completeEvent();
    await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });
    // A correction after settlement: the final was really won by T2, 66 to 70.
    context.play(new Map([[7, { home: 'T1', away: 'T2', winner: AWAY, homeScore: 66, awayScore: 70 }]]));

    const leaderboard = await context.contestService.getBracketLeaderboard(context.contest.id, context.viewer.id);

    expect(leaderboard.entries.map((row) => [row.entryName, row.displayPosition, row.points, row.maxPossiblePoints])).toEqual([
      ['Alice', '1', 12, 12],
      ['Bob', '2', 12, 12],
      ['Cara', '3', 5, 5],
    ]);
  });

  it('answers a bracket whose event was cancelled with every entry unscored, since a cancelled event counts for nothing', async () => {
    const context = setup();
    context.play(ROUND_ONE_CHALK, ROUND_TWO_CHALK, FINAL_T1_70_66);
    context.world.sportEvents.set(context.sportEvent.id, { ...expectDefined(context.world.sportEvents.get(context.sportEvent.id)), status: SportEventStatus.CANCELLED });
    await context.settlement.settleFinishedSportEvent(context.sportEvent.id, { completedAt: SETTLED_AT });

    const leaderboard = await context.contestService.getBracketLeaderboard(context.contest.id, context.viewer.id);

    expect(leaderboard).toMatchObject({ eventCancelled: true, gameCount: 0, finalTotalPoints: null });
    expect(leaderboard.entries.map((row) => [row.entryName, row.points, row.maxPossiblePoints, row.correctPickCount])).toEqual([
      ['Alice', 0, 0, 0],
      ['Bob', 0, 0, 0],
      ['Cara', 0, 0, 0],
    ]);
  });
});

describe('ContestService — roster reads and writes a prediction contest refuses', () => {
  it('refuses the roster leaderboard of a bracket contest with CONTEST_FORMAT_MISMATCH', async () => {
    const context = setup();

    const error = await context.contestService.getLeaderboard(context.contest.id, context.viewer.id).then(() => undefined, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ContestOperationError);
    expect(error).toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
  });

  it('refuses the roster leaderboard of a pick\'em contest with CONTEST_FORMAT_MISMATCH', async () => {
    const context = setup();
    context.world.contests.set(context.contest.id, { ...context.contest, selectionType: SelectionType.PICK_EM });

    const error = await context.contestService.getLeaderboard(context.contest.id, context.viewer.id).then(() => undefined, (caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
  });

  it('refuses setting a bracket entry\'s tiebreaker through the entry update with CONTEST_FORMAT_MISMATCH, leaving it unchanged', async () => {
    const context = setup({ contestStatus: ContestStatus.OPEN });
    context.setNow(BEFORE_START);
    const owner = context.world.addUser({ email: 'owner@example.com' });
    context.world.addMember(context.contest.leagueId, owner.id);
    const alice = expectDefined(context.world.entries.get('entry-alice'));
    context.world.addSquadMember(alice.squadId, owner.id);

    const error = await context.contestService.updateEntry(context.contest.id, alice.id, owner.id, { tiebreakerValue: 99 })
      .then(() => undefined, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(ContestEntryOperationError);
    expect(error).toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
    expect(contestEntryEventTiebreaker(expectDefined(context.world.entries.get('entry-alice')), context.sportEvent.id)).toBe(140);
  });
});
