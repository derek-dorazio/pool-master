/**
 * The tiebreaker game of an event slot (#2048, plan §9c): one Game per slot whose combined score
 * an entry guesses, shared by every contest covering the slot. One rule chooses it, and this is
 * its one computation: the latest scheduled start, a tie going to the lower Game id. A FINAL slot's
 * is its championship; a regular week's is its last kickoff.
 */

import { MatchStatus } from './enums';
import { isMatchUnplayed } from './match-status';

/** What the rule reads of one of a slot's Games. */
export interface SlotTiebreakerCandidate {
  id: string;
  /** When the Game is scheduled to start; null until the schedule gives it one. */
  scheduledDate: Date | null;
  status: MatchStatus;
  /** Whether the provider moved the Game to another slot's event: it is played there, not here. */
  moved: boolean;
}

/** Whether the rule can choose the Game: it is still in the slot, not cancelled, and scheduled. */
export function canBeSlotTiebreaker(game: SlotTiebreakerCandidate): boolean {
  return !game.moved && game.status !== MatchStatus.CANCELLED && game.scheduledDate !== null;
}

/** The slot's tiebreaker game by the rule: the latest start, ties to the lower Game id. Null while no Game can be one. */
export function chooseSlotTiebreakerGame<Game extends SlotTiebreakerCandidate>(games: readonly Game[]): Game | null {
  let chosen: Game | null = null;
  for (const game of games) {
    if (!canBeSlotTiebreaker(game)) continue;
    if (chosen === null) {
      chosen = game;
      continue;
    }
    const start = (game.scheduledDate as Date).getTime();
    const chosenStart = (chosen.scheduledDate as Date).getTime();
    if (start > chosenStart || (start === chosenStart && game.id < chosen.id)) chosen = game;
  }
  return chosen;
}

/**
 * Whether the tiebreaker game has started, after which its choice is fixed: it is under way or
 * played, or its scheduled start has passed.
 */
export function hasTiebreakerGameStarted(game: Pick<SlotTiebreakerCandidate, 'scheduledDate' | 'status'>, now: Date): boolean {
  if (!isMatchUnplayed(game.status)) return true;
  return game.scheduledDate !== null && game.scheduledDate.getTime() <= now.getTime();
}
