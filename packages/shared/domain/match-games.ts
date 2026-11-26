/**
 * Facts about a match read from its Games (#2047). A match keeps no completion time, venue or
 * neutral-site flag of its own: each is its Games', and every reader takes it from here.
 */

import { MatchStatus } from './enums';
import type { SportEventRoundMatch } from './sport-catalog-types';

type MatchWithGames = Pick<SportEventRoundMatch, 'status' | 'games'>;

/**
 * When the match's result was recorded: the latest completion time among its Games, once the
 * match is COMPLETED. Null in any other status.
 */
export function matchCompletedAt(match: MatchWithGames): Date | null {
  if (match.status !== MatchStatus.COMPLETED) return null;
  const times = match.games.flatMap((game) => (game.completedAt === null ? [] : [game.completedAt.getTime()]));
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/** Neither side is at home in any of the match's Games: screens then say "vs" rather than "at". */
export function matchIsNeutralSite(match: Pick<SportEventRoundMatch, 'games'>): boolean {
  return match.games.length > 0 && match.games.every((game) => game.isNeutralSite);
}
