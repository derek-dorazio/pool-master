/**
 * The one rule for a draft contest that can never open (#1161, #1217), as a Prisma filter: what
 * the league's current contests leave out and what a championship year's close ignores (#2021).
 * Slice 16 (#2015) replaces its body with the covered-slot cutoff; every reader keeps calling it.
 */

import type { Prisma } from '@prisma/client';
import { ContestStatus, FINISHED_SPORT_EVENT_STATUSES, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';

/**
 * A draft past every cutoff: one with an event finished or cancelled, and one closing at its
 * event's start once an event has started, since a started event cannot be removed. Only a squares
 * contest with its game closes later, as `contestCutoff` says.
 */
export function neverOpeningDraft(now: Date): Prisma.ContestWhereInput {
  return {
    status: ContestStatus.DRAFT,
    OR: [
      { seasonSlots: { some: { seasonSlot: { eventSlot: { sportEvent: { status: { in: [...FINISHED_SPORT_EVENT_STATUSES] } } } } } } },
      {
        // Started as `hasSportEventStarted` has it: by its start date, or under way early.
        seasonSlots: { some: { seasonSlot: { eventSlot: { sportEvent: { OR: [{ startDate: { lte: now } }, { status: SportEventStatus.IN_PROGRESS }] } } } } },
        NOT: { selectionType: SelectionType.SQUARES, squaresGame: { isNot: null } },
      },
    ],
  };
}
