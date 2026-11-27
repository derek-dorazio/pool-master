/**
 * The round a golf field is on, for the contest leaderboard's header (#2008): the API says it so
 * the web app derives nothing from the field.
 */
import { describe, expect, it } from '@jest/globals';
import { GameSideStatus } from '@poolmaster/shared/domain';
import { currentRoundOfField } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/scored-rounds';
import { golfRound } from '../../support/golf-rounds';

type Round = Parameters<typeof golfRound>[0];

const golfer = (...rounds: Round[]) => ({ fieldResults: rounds.map(golfRound) });
const finished = (roundNumber: number): Round => ({ roundNumber, strokes: 70, scoreToPar: -2, status: GameSideStatus.FINISHED });
const onCourse = (roundNumber: number): Round => ({ roundNumber, strokes: 33, scoreToPar: -1, thru: 9, status: null });

describe('the round a golf field is on', () => {
  it('names no round for an empty field, or one with no scored round', () => {
    expect(currentRoundOfField([])).toBeNull();
    expect(currentRoundOfField([golfer()])).toBeNull();
  });

  it('names the highest round a golfer is still playing, as in progress', () => {
    expect(currentRoundOfField([golfer(finished(1), onCourse(2))])).toEqual({ roundNumber: 2, isComplete: false });
  });

  it('names a round still being played over a higher one an early starter has already finished', () => {
    expect(currentRoundOfField([golfer(finished(3)), golfer(onCourse(2))])).toEqual({ roundNumber: 2, isComplete: false });
  });

  it('names the highest finished round, as complete, when nobody is on the course', () => {
    expect(currentRoundOfField([golfer(finished(1), finished(2))])).toEqual({ roundNumber: 2, isComplete: true });
  });

  it('never names a round a golfer only withdrew or was disqualified in', () => {
    expect(currentRoundOfField([golfer(
      finished(1),
      { roundNumber: 2, strokes: 40, scoreToPar: 4, status: GameSideStatus.DID_NOT_FINISH },
      { roundNumber: 3, strokes: 20, scoreToPar: 2, status: GameSideStatus.DISQUALIFIED },
    )])).toEqual({ roundNumber: 1, isComplete: true });
  });
});
