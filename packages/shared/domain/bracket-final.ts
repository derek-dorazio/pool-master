import type { SportEventRoundMatch } from './sport-catalog-types';
import { SlotKind } from './enums';

/** What finding an event's final reads of each of its games: its slot and where its winner goes. */
export interface FinalCandidate {
  roundNumber: number;
  slot: { readonly seasonSlotId: string; readonly slotKind: SlotKind };
  /** Whether the game's winner moves on to another game. */
  advances: boolean;
}

/**
 * The rounds an event's final is played in (#2006): the round of its FINAL slot. An event played
 * in one slot with no FINAL kind (a tennis Slam's TOURNAMENT slot) has its final where its bracket's
 * links end: the round of its one game whose winner goes nowhere. Never the last round by number.
 * Empty for games that form no bracket (a week of games, none linked), and for a one-slot bracket
 * whose links end in more than one game.
 */
export function finalRoundNumbers(games: readonly FinalCandidate[]): Set<number> {
  const inFinalSlot = games.filter((game) => game.slot.slotKind === SlotKind.FINAL);
  if (inFinalSlot.length > 0) return new Set(inFinalSlot.map((game) => game.roundNumber));
  const slots = new Set(games.map((game) => game.slot.seasonSlotId));
  if (slots.size !== 1 || !games.some((game) => game.advances)) return new Set();
  const ends = games.filter((game) => !game.advances);
  return ends.length === 1 ? new Set(ends.map((game) => game.roundNumber)) : new Set();
}

/** `finalRoundNumbers` of an event's stored games. */
export function finalRoundsOfMatches(
  matches: ReadonlyArray<Pick<SportEventRoundMatch, 'roundNumber' | 'slot' | 'advancesToMatchId'>>,
): Set<number> {
  return finalRoundNumbers(matches.map((match) => ({ roundNumber: match.roundNumber, slot: match.slot, advances: match.advancesToMatchId !== null })));
}
