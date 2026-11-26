import { roundLabels } from '@poolmaster/shared/display-strings';
import { SlotKind, type RoundName } from '@poolmaster/shared/domain';
import type { SportEventRoundSlotDto } from '@/lib/api';

/** A round's slot as the API sends it (#2006); one Season slot per kind and week. */
export function roundSlot(slotKind: SlotKind, name: string | null = null, weekNumber: number | null = null): SportEventRoundSlotDto {
  return { seasonSlotId: `slot-${slotKind}-${String(weekNumber ?? 0)}`, name, slotKind, weekNumber };
}

/** A 64-team tournament's six rounds, first to final, by their slots. */
export const TOURNAMENT_ROUND_SLOTS = [
  roundSlot(SlotKind.ROUND_OF_64, 'First Round'),
  roundSlot(SlotKind.ROUND_OF_32, 'Round of 32'),
  roundSlot(SlotKind.ROUND_OF_16, 'Sweet 16'),
  roundSlot(SlotKind.QUARTERFINAL, 'Elite Eight'),
  roundSlot(SlotKind.SEMIFINAL, 'Final Four'),
  roundSlot(SlotKind.FINAL, 'National Championship'),
] as const;

/** A week of games' slot. */
export function weekSlot(weekNumber: number): SportEventRoundSlotDto {
  return roundSlot(SlotKind.WEEK, null, weekNumber);
}

/** The tournament's rounds by number, named by their slots as the screens name them. */
export const tournamentRoundName: RoundName = roundLabels(TOURNAMENT_ROUND_SLOTS.map((slot, index) => ({ roundNumber: index + 1, slot })));
