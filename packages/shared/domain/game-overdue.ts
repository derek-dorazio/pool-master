/**
 * When a Game's result is overdue (#2013): it should have ended, from its scheduled start plus its
 * provider league's typical game length, more than OVERDUE_AFTER_MS ago, and it is still scheduled
 * or in progress. The sync tick raises a GAME_OVERDUE finding for it, and resolves the finding
 * once the Game is no longer overdue. A finished, cancelled or postponed Game never is, nor one
 * with no scheduled start.
 */
import { MatchStatus } from './enums';

/** How long after its expected end a Game's missing result counts as overdue: 4 hours (Derek, 2026-11-18). */
export const OVERDUE_AFTER_MS = 4 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/** The Game statuses still waiting on a result: the ones a Game can be overdue in. */
const AWAITING_RESULT_STATUSES: readonly MatchStatus[] = [MatchStatus.SCHEDULED, MatchStatus.IN_PROGRESS];

/** One Game as the overdue check reads it. */
export interface OverdueGameFacts {
  status: MatchStatus;
  scheduledDate: Date | null;
}

/**
 * When the Game should have ended, or null while it is not overdue at `now`: its scheduled start
 * plus `typicalGameMinutes`, once that is more than OVERDUE_AFTER_MS behind `now` and the Game is
 * still scheduled or in progress. How late it is runs from the time this returns.
 */
export function gameOverdueExpectedEnd(game: OverdueGameFacts, typicalGameMinutes: number, now: Date): Date | null {
  if (!AWAITING_RESULT_STATUSES.includes(game.status) || game.scheduledDate === null) return null;
  const expectedEnd = new Date(game.scheduledDate.getTime() + typicalGameMinutes * MINUTE_MS);
  return now.getTime() - expectedEnd.getTime() > OVERDUE_AFTER_MS ? expectedEnd : null;
}

/**
 * The latest scheduled start a Game may have and be overdue at `now`, whatever its typical length:
 * a reader need only look at Games that started before this.
 */
export function overdueStartCutoff(now: Date): Date {
  return new Date(now.getTime() - OVERDUE_AFTER_MS);
}
