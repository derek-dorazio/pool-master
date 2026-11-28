/**
 * The one rule for a draft contest that can never open (#1161, #1217), as a Prisma filter: what
 * the league's current contests leave out and what a championship year's close ignores (#2021).
 * Slice 16 (#2015) replaces its body with its one cutoff rule; every reader keeps calling it.
 */

import type { Prisma } from '@prisma/client';
import { ContestStatus, FINISHED_SPORT_EVENT_STATUSES, SeasonSlotStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';

/**
 * A draft past every cutoff: one with an event finished or cancelled, which is past every cutoff,
 * and one closing at its first covered Game once a slot it covers has started (#2013), since a
 * started slot cannot be removed. Only a squares contest with its game closes later, as
 * `contestCutoff` says.
 */
export function neverOpeningDraft(now: Date): Prisma.ContestWhereInput {
  return {
    status: ContestStatus.DRAFT,
    OR: [
      { seasonSlots: { some: { seasonSlot: { eventSlot: { sportEvent: { status: { in: [...FINISHED_SPORT_EVENT_STATUSES] } } } } } } },
      // Started as `cutoffTiming` has it: a synced slot in progress or complete, or not
      // cancelled and past its first game's start (one with no start yet is not scheduled, so
      // it has not started); a test slot goes by its event, past its start or under way.
      ...[
        { isTestData: false, status: { in: [SeasonSlotStatus.IN_PROGRESS, SeasonSlotStatus.COMPLETED] } },
        { isTestData: false, status: { not: SeasonSlotStatus.CANCELLED }, startsAt: { lte: now } },
        { isTestData: true, eventSlot: { sportEvent: { OR: [{ startDate: { lte: now } }, { status: SportEventStatus.IN_PROGRESS }] } } },
      ].map((started) => ({
        seasonSlots: { some: { seasonSlot: started } },
        NOT: { selectionType: SelectionType.SQUARES, squaresGame: { isNot: null } },
      })),
    ],
  };
}
