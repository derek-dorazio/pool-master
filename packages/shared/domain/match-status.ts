import { MatchStatus } from './enums';

/**
 * Statuses of a game still to be played (#1791): SCHEDULED, and POSTPONED, which a game takes only
 * before it begins. Both lock its picks at its time, new or old, and neither has a score.
 */
export const UNPLAYED_MATCH_STATUSES: readonly MatchStatus[] = [MatchStatus.SCHEDULED, MatchStatus.POSTPONED];

/** Whether a game is still to be played: scheduled, or postponed before it began. */
export function isMatchUnplayed(status: MatchStatus): boolean {
  return UNPLAYED_MATCH_STATUSES.includes(status);
}
