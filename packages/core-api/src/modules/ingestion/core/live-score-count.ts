import type { LiveScoreResult } from '@poolmaster/shared/dto';

/**
 * How many updates a `LiveScoreResult` carries, for run diagnostics: golf rounds or games. One
 * definition for the publisher and the scheduler.
 */
export function countLiveScoreUpdates(result: LiveScoreResult): number {
  return result.category === 'GOLF' ? result.rounds.length : result.games.length;
}
