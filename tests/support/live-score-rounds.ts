import type { GolfRoundUpdate, LiveScoreResult } from '@poolmaster/shared/dto';

/** A golf live-score result's round updates; any other category fails the test that read it. */
export function golfRoundsOf(result: LiveScoreResult): GolfRoundUpdate[] {
  if (result.category !== 'GOLF') throw new Error(`Expected GOLF live scores, got ${result.category}`);
  return result.rounds;
}
