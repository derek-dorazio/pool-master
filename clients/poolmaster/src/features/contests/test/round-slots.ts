import { SlotKind } from '@poolmaster/shared/domain';
import type { SportEventRoundDto, SportEventRoundSlotDto } from '@/lib/api';

/** A round's slot as the API sends it (#2006); one Season slot per kind and week. */
export function roundSlot(slotKind: SlotKind, name: string | null = null, weekNumber: number | null = null): SportEventRoundSlotDto {
  return { seasonSlotId: `slot-${slotKind}-${String(weekNumber ?? 0)}`, name, slotKind, weekNumber, periods: null };
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

/** An event's rounds as `listEventRounds` answers them: round n played in `slots[n - 1]`. */
export function eventRoundsResponse(sportEventId: string, slots: readonly SportEventRoundSlotDto[]): { data: { rounds: SportEventRoundDto[] } } {
  return {
    data: {
      rounds: slots.map((slot, index) => ({
        id: `${sportEventId}-round-${String(index + 1)}`,
        sportEventId,
        roundNumber: index + 1,
        slot,
        scheduledDate: '2026-01-10T18:00:00.000Z',
        scheduledEndAt: null,
        status: 'SCHEDULED',
        resultCount: 0,
        completedAt: null,
      })),
    },
  };
}

/** An NFL-shaped two-round playoff's slots: the conference championships, then the Super Bowl. */
export const PLAYOFF_ROUND_SLOTS = [
  roundSlot(SlotKind.SEMIFINAL, 'Conference Championship'),
  roundSlot(SlotKind.FINAL, 'Super Bowl'),
] as const;
