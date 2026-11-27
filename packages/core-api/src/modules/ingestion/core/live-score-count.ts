import type { LiveScoreResult } from '@poolmaster/shared/dto';

/**
 * How many updates a `LiveScoreResult` carries, for run diagnostics: golf rounds, games (scores or
 * box scores), or runners' session results. One definition for the publisher and the scheduler.
 */
export function countLiveScoreUpdates(result: LiveScoreResult): number {
  switch (result.category) {
    case 'GOLF': return result.rounds.length;
    case 'GAME': return result.games.length;
    case 'RACE': return result.sessions.reduce((total, session) => total + session.runners.length, 0);
  }
}
