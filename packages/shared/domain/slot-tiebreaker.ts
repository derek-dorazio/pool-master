/**
 * The tiebreaker game of an event slot (#2048, plan §9c): one Game per slot whose combined score
 * an entry guesses, shared by every contest covering the slot. One rule chooses it, and this is
 * its one computation: the latest scheduled start, a tie going to the lower Game id. A Game with no
 * start yet ranks after every scheduled one, the later round first, so a slot names a game from the
 * moment it has one: a bracket's final is its tiebreaker game from entry time, before the schedule
 * dates it. A FINAL slot's is its championship; a regular week's is its last kickoff.
 */

import { MatchStatus } from './enums';
import { isMatchUnplayed } from './match-status';

/** What the rule reads of one of a slot's Games. */
export interface SlotTiebreakerCandidate {
  id: string;
  /** When the Game is scheduled to start; null until the schedule gives it one. */
  scheduledDate: Date | null;
  /** The round the Game's match is played in: among unscheduled Games, the later round ranks first. */
  roundNumber: number;
  status: MatchStatus;
  /** Whether the provider moved the Game to another slot's event: it is played there, not here. */
  moved: boolean;
}

/** Whether the rule can choose the Game: it is still in the slot and not cancelled. */
export function canBeSlotTiebreaker(game: SlotTiebreakerCandidate): boolean {
  return !game.moved && game.status !== MatchStatus.CANCELLED;
}

/** Whether `game` ranks ahead of `other` by the rule: a later start, any start before none, a later round among the unscheduled, then the lower id. */
function ranksAhead(game: SlotTiebreakerCandidate, other: SlotTiebreakerCandidate): boolean {
  const start = game.scheduledDate?.getTime() ?? null;
  const otherStart = other.scheduledDate?.getTime() ?? null;
  if (start !== otherStart) {
    if (start === null) return false;
    if (otherStart === null) return true;
    return start > otherStart;
  }
  if (start === null && game.roundNumber !== other.roundNumber) return game.roundNumber > other.roundNumber;
  return game.id < other.id;
}

/** The slot's tiebreaker game by the rule. Null while no Game can be one. */
export function chooseSlotTiebreakerGame<Game extends SlotTiebreakerCandidate>(games: readonly Game[]): Game | null {
  let chosen: Game | null = null;
  for (const game of games) {
    if (!canBeSlotTiebreaker(game)) continue;
    if (chosen === null || ranksAhead(game, chosen)) chosen = game;
  }
  return chosen;
}

/**
 * Whether the tiebreaker game has started, after which its choice is fixed: it is under way or
 * played, or its scheduled start has passed. A postponed game whose first start has passed counts
 * as started until its new start is written, which goes through the bracket service and runs the
 * rule again.
 */
export function hasTiebreakerGameStarted(game: Pick<SlotTiebreakerCandidate, 'scheduledDate' | 'status'>, now: Date): boolean {
  if (!isMatchUnplayed(game.status)) return true;
  return game.scheduledDate !== null && game.scheduledDate.getTime() <= now.getTime();
}
