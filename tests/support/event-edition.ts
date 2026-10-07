/**
 * plans/147 — every SportEvent is one edition of an EventSeries, in one event year, and a
 * series has at most one edition per year. A test that writes an event row directly needs
 * both, and usually does not care about either.
 *
 * `freshEventEdition` gives each such event a series of its own on a shared fixture tour, so
 * two fixtures never collide on the one-edition-per-year constraint by accident. A test about
 * series, years or that constraint builds its own series instead.
 *
 * The fixture tour hangs off the GOLF sport row because the sport list validates names against
 * the Sport enum; a made-up sport row would break any contract test that lists sports.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const FIXTURE_TOUR_NAME = 'Fixture Tour (plans/147 test editions)';

const LINKED_EVENT_ROUNDS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, 'sport' | 'sportLeague' | 'eventSeries'>;

export interface EventEdition {
  eventSeriesId: string;
  eventYear: number;
}

export async function freshEventEdition(
  prisma: Db,
  options: { name?: string; eventYear?: number } = {},
): Promise<EventEdition> {
  const sport = await prisma.sport.upsert({
    where: { name: 'GOLF' },
    create: { name: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const tour = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: FIXTURE_TOUR_NAME } },
    create: { sportId: sport.id, name: FIXTURE_TOUR_NAME },
    update: {},
  });
  const series = await prisma.eventSeries.create({
    data: { sportLeagueId: tour.id, name: `${options.name ?? 'Fixture series'} ${randomUUID()}` },
  });
  return { eventSeriesId: series.id, eventYear: options.eventYear ?? new Date().getUTCFullYear() };
}

/** Removes the fixture tour's series that no event uses any more. */
export async function cleanupFreshEventEditions(prisma: Pick<PrismaClient, 'eventSeries'>): Promise<void> {
  await prisma.eventSeries.deleteMany({
    where: { sportLeague: { name: FIXTURE_TOUR_NAME }, sportEvents: { none: {} } },
  });
}

/**
 * plans/147 — sync updates only an event already linked to the provider event; it never
 * creates one. This is the row a sync test starts from: an event in a fresh series, holding
 * the provider identity, as an admin creating and linking it would leave it, already released
 * (the column default, SCHEDULED). Like an admin-created event it is
 * linked for scores (SCORES_ONLY) and has a four-round schedule, a round a day from the start,
 * because a feed never creates a round (#435).
 */
export async function linkedProviderEvent(
  prisma: Db & Pick<PrismaClient, 'sportEvent'>,
  input: {
    providerId: string;
    externalId: string;
    name: string;
    startDate: Date;
    sport?: string;
  },
) {
  return prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { name: input.name, eventYear: input.startDate.getUTCFullYear() })),
      providerId: input.providerId,
      externalId: input.externalId,
      sport: input.sport ?? 'GOLF',
      name: input.name,
      startDate: input.startDate,
      syncScope: 'SCORES_ONLY',
      rounds: LINKED_EVENT_ROUNDS,
      roundSchedule: {
        create: Array.from({ length: LINKED_EVENT_ROUNDS }, (_, index) => ({
          roundNumber: index + 1,
          scheduledDate: new Date(input.startDate.getTime() + index * MS_PER_DAY),
        })),
      },
    },
  });
}
