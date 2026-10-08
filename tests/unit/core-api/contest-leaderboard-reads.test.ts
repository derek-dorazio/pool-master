import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  toParticipantScores,
} from '../../../packages/core-api/src/modules/contests/contest-leaderboard-reads';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';

// What the live leaderboard and settlement both read: a missing configuration, a configuration
// with its optional counts unset, an entry with no picks, and a golfer with no standing yet.

describe('contest leaderboard reads', () => {
  it('reads no scoring configuration for a contest that has none, without asking for its rules', async () => {
    const scoringRules = fakeParticipantContestScoringRuleRepo();

    await expect(loadContestScoringConfiguration({
      configurations: fakeContestConfigurationRepo({ findByContest: jest.fn().mockResolvedValue(null) }),
      scoringRules,
    }, 'contest-1')).resolves.toBeNull();
    expect(scoringRules.findByContestConfiguration).not.toHaveBeenCalled();
  });

  it('reads unset roster size, pick count, rounds and config JSON as null', async () => {
    const configuration = await loadContestScoringConfiguration({
      configurations: fakeContestConfigurationRepo({
        findByContest: jest.fn().mockResolvedValue({ id: 'config-1', contestId: 'contest-1' }),
      }),
      scoringRules: fakeParticipantContestScoringRuleRepo({
        findByContestConfiguration: jest.fn().mockResolvedValue([
          { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true },
        ]),
      }),
    }, 'contest-1');

    expect(configuration).toEqual({
      configJson: null,
      rosterSize: null,
      pickCount: null,
      rounds: null,
      participantScoringRules: [{ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true }],
    });
  });

  it('reads only active entries, gives an entry with no picks an empty list, and an unslotted pick a null slot', async () => {
    const entries = fakeContestEntryRepo({
      findByContestWithSquad: jest.fn().mockResolvedValue([
        { id: 'entry-1', entryNumber: 1, name: 'One', status: 'ACTIVE', squadId: 'squad-1', squadName: 'Squad One' },
        { id: 'entry-2', entryNumber: 2, name: 'Two', status: 'ACTIVE', squadId: 'squad-2', squadName: 'Squad Two' },
      ]),
    });
    const pickedAt = new Date('2026-05-30T12:00:00.000Z');

    const rows = await loadContestLeaderboardEntries({
      entries,
      picks: fakeContestEntryPickRepo({
        findByEntries: jest.fn().mockResolvedValue([
          { id: 'pick-1', entryId: 'entry-1', sportEventParticipantId: 'sep-1', pickedAt, slot: undefined },
        ]),
      }),
    }, 'contest-1');

    expect(entries.findByContestWithSquad).toHaveBeenCalledWith('contest-1', { activeOnly: true });
    expect(rows.map((row) => [row.id, row.squad.name, row.picks])).toEqual([
      ['entry-1', 'Squad One', [{ id: 'pick-1', sportEventParticipantId: 'sep-1', pickedAt, slot: null }]],
      ['entry-2', 'Squad Two', []],
    ]);
  });

  it('scores a golfer by their event to-par, and leaves a golfer with no standing unscored', () => {
    const asOf = new Date('2026-05-31T18:00:00.000Z');
    const scores = toParticipantScores([
      {
        entry: { id: 'sep-1', isActive: true },
        participant: { name: 'Ana Park' },
        standing: { standing: { asOf, status: 'ACTIVE' }, golf: { eventScoreToPar: 0 } },
        rounds: [],
      },
      { entry: { id: 'sep-2', isActive: true }, participant: { name: 'Ben Cole' }, standing: null, rounds: [] },
    ] as unknown as Parameters<typeof toParticipantScores>[0], scoringEvent({ rounds: 4, roundsPar: 72 }));

    expect(scores).toEqual([
      { sportEventParticipantId: 'sep-1', name: 'Ana Park', score: 0, asOf, unplayedRoundNumbers: [] },
      { sportEventParticipantId: 'sep-2', name: 'Ben Cole', score: null, asOf: null, unplayedRoundNumbers: [] },
    ]);
  });
});

// #478: every round a golfer does not play scores a fixed 80 strokes in contest scoring, as
// 80 minus that round's par against par.
describe('contest scoring of unplayed rounds', () => {
  // Made the cut and finished all four rounds at par 72, so each round's par is derivable.
  const leader = golfer('sep-leader', 'COMPLETE', [
    [1, 'COMPLETED', 70, -2],
    [2, 'COMPLETED', 70, -2],
    [3, 'COMPLETED', 70, -2],
    [4, 'COMPLETED', 70, -2],
  ]);

  it('scores a golfer cut after round 2 on par-72 rounds as their two rounds plus +8 for each of rounds 3 and 4', () => {
    const cut = golfer('sep-cut', 'ELIMINATED', [
      [1, 'COMPLETED', 72, 0],
      [2, 'MISSED_CUT', 74, 2],
    ]);

    const [, score] = toParticipantScores(field(leader, cut), scoringEvent({ rounds: 4, roundsPar: null }));

    expect(score).toMatchObject({ sportEventParticipantId: 'sep-cut', score: 18, unplayedRoundNumbers: [3, 4] });
  });

  it('keeps round 1 of a golfer who withdrew during round 2 and scores +8 for each of rounds 2, 3 and 4', () => {
    const withdrawn = golfer('sep-wd', 'WITHDRAWN', [
      [1, 'COMPLETED', 71, -1],
      [2, 'DNF', 40, 3],
    ]);

    const [, score] = toParticipantScores(field(leader, withdrawn), scoringEvent({ rounds: 4, roundsPar: null }));

    expect(score).toMatchObject({ score: 23, unplayedRoundNumbers: [2, 3, 4] });
  });

  it('scores a golfer who withdrew before the event +8 for every scheduled round', () => {
    const removed = golfer('sep-removed', null, [], { isActive: false, inactiveReason: 'WITHDRAWN' });

    const [score] = toParticipantScores(field(removed), scoringEvent({ rounds: 4, roundsPar: 72 }));

    expect(score).toMatchObject({ score: 32, unplayedRoundNumbers: [1, 2, 3, 4] });
  });

  it('scores a golfer removed from the field after round 1 for that round plus 80 for each round after it', () => {
    const removed = golfer('sep-removed', 'COMPLETE', [[1, 'COMPLETED', 75, 3]], { isActive: false });

    const [, score] = toParticipantScores(field(leader, removed), scoringEvent({ rounds: 4, roundsPar: null }));

    expect(score).toMatchObject({ score: 27, unplayedRoundNumbers: [2, 3, 4] });
  });

  it('takes par from the event\'s roundsPar over the field\'s rounds, so 80 is +10 on a par 70', () => {
    const cut = golfer('sep-cut', 'ELIMINATED', [
      [1, 'COMPLETED', 72, 0],
      [2, 'MISSED_CUT', 74, 2],
    ]);

    const [, score] = toParticipantScores(field(leader, cut), scoringEvent({ rounds: 4, roundsPar: 70 }));

    expect(score).toMatchObject({ score: 22, unplayedRoundNumbers: [3, 4] });
  });

  it('adds no penalty for a round whose par is not known yet: no roundsPar and nobody has finished it', () => {
    const midRound3 = golfer('sep-leader', 'IN_PROGRESS', [
      [1, 'COMPLETED', 70, -2],
      [2, 'COMPLETED', 70, -2],
      [3, 'COMPLETED', 70, -2],
      [4, 'IN_PROGRESS', 33, -1],
    ]);
    const cut = golfer('sep-cut', 'ELIMINATED', [
      [1, 'COMPLETED', 72, 0],
      [2, 'MISSED_CUT', 74, 2],
    ]);

    const [, score] = toParticipantScores(field(midRound3, cut), scoringEvent({ rounds: 4, roundsPar: null }));

    expect(score).toMatchObject({ score: 10, unplayedRoundNumbers: [3] });
  });

  it('never scores a round past the event\'s scheduled rounds', () => {
    const withdrawn = golfer('sep-wd', 'WITHDRAWN', [[1, 'DNF', 30, 1]]);

    const [score] = toParticipantScores(field(withdrawn), scoringEvent({ rounds: 2, roundsPar: 72 }));

    expect(score).toMatchObject({ score: 16, unplayedRoundNumbers: [1, 2] });
  });

  it('leaves a golfer with no score unscored while the field is still on the round, then scores 80 once the field moves past it', () => {
    const roundOneLeader = golfer('sep-leader', 'COMPLETE', [[1, 'COMPLETED', 70, -2]]);
    const noScore = golfer('sep-none', null, []);

    expect(toParticipantScores(field(roundOneLeader, noScore), scoringEvent({ rounds: 4, roundsPar: null }))[1])
      .toMatchObject({ score: null, unplayedRoundNumbers: [] });

    const roundTwoStarted = golfer('sep-leader', 'IN_PROGRESS', [
      [1, 'COMPLETED', 70, -2],
      [2, 'IN_PROGRESS', 20, -1],
    ]);
    expect(toParticipantScores(field(roundTwoStarted, noScore), scoringEvent({ rounds: 4, roundsPar: null }))[1])
      .toMatchObject({ score: 8, unplayedRoundNumbers: [1] });
  });

  it('scores a golfer with no score 80 for every round once the event is complete', () => {
    const noScore = golfer('sep-none', null, []);

    const [, score] = toParticipantScores(field(leader, noScore), scoringEvent({ rounds: 4, roundsPar: null, status: 'COMPLETED' }));

    expect(score).toMatchObject({ score: 32, unplayedRoundNumbers: [1, 2, 3, 4] });
  });

  it('keeps a golfer still playing at their live to-par, even with a round in progress after the field has moved on', () => {
    const suspended = golfer('sep-live', 'IN_PROGRESS', [
      [1, 'COMPLETED', 70, -2],
      [2, 'IN_PROGRESS', 30, 1],
    ]);

    const [, score] = toParticipantScores(field(leader, suspended), scoringEvent({ rounds: 4, roundsPar: null }));

    expect(score).toMatchObject({ score: -1, unplayedRoundNumbers: [] });
  });
});

type RoundTuple = [roundNumber: number, status: string, strokes: number, scoreToPar: number];

function golfer(
  id: string,
  standingStatus: string | null,
  rounds: RoundTuple[],
  entry: { isActive?: boolean; inactiveReason?: string } = {},
) {
  const eventScoreToPar = rounds.reduce((sum, [, , , scoreToPar]) => sum + scoreToPar, 0);
  return {
    entry: { id, isActive: entry.isActive ?? true, inactiveReason: entry.inactiveReason ?? null },
    participant: { name: id },
    standing: standingStatus === null
      ? null
      : { standing: { asOf: null, status: standingStatus }, golf: { eventScoreToPar } },
    rounds: rounds.map(([roundNumber, status, strokes, scoreToPar]) => ({
      round: { roundNumber, status },
      golf: { strokes, scoreToPar },
    })),
  };
}

function field(...golfers: ReturnType<typeof golfer>[]) {
  return golfers as unknown as Parameters<typeof toParticipantScores>[0];
}

function scoringEvent(event: { rounds: number | null; roundsPar: number | null; status?: string }) {
  return { status: 'IN_PROGRESS', ...event } as unknown as Parameters<typeof toParticipantScores>[1];
}
