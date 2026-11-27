import { MatchStatus } from '@poolmaster/shared/domain';
import { scoredRoundsOf } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/scored-rounds';
import { golfRound } from '../../support/golf-rounds';

// A golfer's rounds are their side results in the event's FIELD Games (#2008): what counts as a
// scored round.

describe('scoredRoundsOf', () => {
  it('keeps the side results with strokes and to-par, in their order, and leaves out a side with no score (a race\'s)', () => {
    const one = golfRound({ roundNumber: 1, strokes: 70, scoreToPar: -2 });
    const two = golfRound({ roundNumber: 2, strokes: 71, scoreToPar: -1 });
    const unscored = { ...golfRound({ roundNumber: 3, strokes: 0, scoreToPar: 0 }), gameStatus: MatchStatus.COMPLETED };
    const race = { ...unscored, result: { ...unscored.result, score: null, scoreToPar: null } };

    expect(scoredRoundsOf({ fieldResults: [one, race, two] }).map((round) => round.roundNumber)).toEqual([1, 2]);
  });
});
