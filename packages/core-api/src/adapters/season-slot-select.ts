/**
 * The one select and row mapping for a Season slot (#2004): what the Structure tab, an event's
 * Slots tab and an event create read of it, with its definition's key, kind, week and name, and its
 * date window (#2012).
 */
import type { Prisma } from '@prisma/client';
import type { SportLeagueSeasonSlot } from '@poolmaster/shared/domain';

export const SEASON_SLOT_SELECT = {
  id: true, sportLeagueCompetitionSlotId: true, startsAt: true, endsAt: true, status: true,
  seriesFormat: true, seriesGames: true, pairing: true, isTestData: true, label: true,
  windowStartsAt: true, windowEndsAt: true, windowStatus: true,
  definition: { select: { key: true, slotKind: true, weekNumber: true, name: true } },
} as const satisfies Prisma.SportLeagueSeasonCompetitionSlotSelect;

export type SeasonSlotRow = Prisma.SportLeagueSeasonCompetitionSlotGetPayload<{ select: typeof SEASON_SLOT_SELECT }>;

export function toSeasonSlot({ sportLeagueCompetitionSlotId, definition, windowStartsAt, windowEndsAt, windowStatus, ...slot }: SeasonSlotRow): SportLeagueSeasonSlot {
  return {
    ...slot,
    ...definition,
    slotDefinitionId: sportLeagueCompetitionSlotId,
    // The database check sets the three window columns together (#2012).
    window: windowStartsAt !== null && windowEndsAt !== null && windowStatus !== null
      ? { startsAt: windowStartsAt, endsAt: windowEndsAt, status: windowStatus }
      : null,
  };
}

/**
 * An event that covers a test slot, as a relation filter on its `slots` (#2004): the one database
 * form of `isTestEvent`. `some` finds test events and `none` leaves them out.
 */
export const COVERS_TEST_SLOT = { seasonSlot: { isTestData: true } } as const satisfies Prisma.SportEventSlotWhereInput;
