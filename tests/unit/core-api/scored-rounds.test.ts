import { GameSideStatus, MatchStatus, ParticipantRoundStatus } from '@poolmaster/shared/domain';
import { roundStatusOfSide, scoredRoundsOf } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/scored-rounds';
import { golfRound } from '../../support/golf-rounds';

// A golfer's rounds are their side results in the event's FIELD Games (#2008): what counts as a
// scored round, and the round progress the API names for each side status.

describe('scoredRoundsOf', () => {
  it('keeps the side results with strokes and to-par, in their order, and leaves out a side with no score (a race\'s)', () => {
    const one = golfRound({ roundNumber: 1, strokes: 70, scoreToPar: -2 });
    const two = golfRound({ roundNumber: 2, strokes: 71, scoreToPar: -1 });
    const unscored = { ...golfRound({ roundNumber: 3, strokes: 0, scoreToPar: 0 }), gameStatus: MatchStatus.COMPLETED };
    const race = { ...unscored, result: { ...unscored.result, score: null, scoreToPar: null } };

    expect(scoredRoundsOf({ fieldResults: [one, race, two] }).map((round) => round.roundNumber)).toEqual([1, 2]);
  });
});

describe('roundStatusOfSide', () => {
  it.each([
    [null, ParticipantRoundStatus.IN_PROGRESS],
    [GameSideStatus.FINISHED, ParticipantRoundStatus.COMPLETED],
    [GameSideStatus.DID_NOT_FINISH, ParticipantRoundStatus.DNF],
    [GameSideStatus.DID_NOT_START, ParticipantRoundStatus.DNF],
    [GameSideStatus.DISQUALIFIED, ParticipantRoundStatus.DSQ],
  ])('names a side status of %s as round progress %s', (status, expected) => {
    expect(roundStatusOfSide(status)).toBe(expected);
  });
});
