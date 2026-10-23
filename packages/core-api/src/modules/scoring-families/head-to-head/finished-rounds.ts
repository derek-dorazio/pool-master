/**
 * When a round of games is finished (#877, `plans/email-notifications.md` Q3.11): there is no
 * round-level record, so it is read off the round's games. A round is finished once every one of
 * its games has its result or was cancelled, and it finished when the last of them was written: a
 * game records no result time of its own, so its last write is when its result went in.
 */
import { MatchStatus, type SportEventMatch } from '@poolmaster/shared/domain';
import type { FinishedRound } from '../stroke-play/finished-rounds';

const DECIDED_MATCH_STATUSES: readonly MatchStatus[] = [MatchStatus.COMPLETED, MatchStatus.CANCELLED];

/** The highest round whose every game is decided, from `fromRound` on, or null before any is. */
export function lastFinishedMatchRound(
  matches: readonly Pick<SportEventMatch, 'roundNumber' | 'status' | 'updatedAt'>[],
  fromRound = 1,
): FinishedRound | null {
  const roundNumbers = [...new Set(matches.map((match) => match.roundNumber))]
    .filter((roundNumber) => roundNumber >= fromRound)
    .sort((left, right) => right - left);
  for (const roundNumber of roundNumbers) {
    const games = matches.filter((match) => match.roundNumber === roundNumber);
    if (games.every((match) => DECIDED_MATCH_STATUSES.includes(match.status))) {
      return { roundNumber, finishedAt: new Date(Math.max(...games.map((match) => match.updatedAt.getTime()))) };
    }
  }
  return null;
}
