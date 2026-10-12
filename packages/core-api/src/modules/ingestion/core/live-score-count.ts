import type { LiveScoreResult } from '@poolmaster/shared/dto';

/**
 * How many per-participant updates a `LiveScoreResult` carries, for run diagnostics. One
 * definition for the publisher and the scheduler. GOLF is the only category (#605).
 */
export function countLiveScoreUpdates(result: LiveScoreResult): number {
  return result.rounds.length;
}
