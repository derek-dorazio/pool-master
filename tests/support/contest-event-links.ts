import type { PrismaClient } from '@prisma/client';

/**
 * Removes every contest's link to the given sport events — its covered slots of theirs, each
 * entry's status in that event, and the event's frozen standings — so a test's cleanup can
 * delete the events. Since #713 those rows hold RESTRICT foreign keys to the event (a contest
 * no longer loses its event silently when the event goes), and a suite's own cleanup runs
 * before the shared one deletes the contests that hold them.
 */
export async function unlinkContestsFromSportEvents(prisma: PrismaClient, sportEventIds: readonly string[]): Promise<void> {
  if (sportEventIds.length === 0) {
    return;
  }
  const where = { sportEventId: { in: [...sportEventIds] } };
  await prisma.contestEntryEventStanding.deleteMany({ where });
  await prisma.contestEntryEvent.deleteMany({ where });
  // A contest covers the events' Season slots (#2014), whose event links the event's delete takes.
  await prisma.contestSeasonSlot.deleteMany({ where: { seasonSlot: { eventSlot: { sportEventId: { in: [...sportEventIds] } } } } });
}
