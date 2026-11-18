import { createEvent, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import type { Sport } from '@poolmaster/shared/domain';
import { getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

/**
 * A season event for a Clutch Card event to name as its parent (#1820): an admin-authored event of
 * the Clutch Card league's season league (the NFL for Championship Weekend), created over HTTP as
 * an admin would, with the season's rounds. A suite that creates Clutch Card events creates one
 * first, since the site refuses a Clutch Card event with no season event.
 */
export async function createSeasonEvent(client: Client, input: {
  sport: Sport;
  sportLeague: string;
  name: string;
  eventYear: number;
  startDate: string;
  endDate: string;
  rounds: number;
}): Promise<string> {
  const sportLeagueId = expectDefined(expectDefined((await listSportLeagues({ client, query: { sport: input.sport } })).data).sportLeagues
    .find((league) => league.name === input.sportLeague), input.sportLeague).id;
  const created = await createEvent({
    client,
    body: { sportLeagueId, eventYear: input.eventYear, name: input.name, startDate: input.startDate, endDate: input.endDate, rounds: input.rounds, autoLifecycleEnabled: false },
  });
  return expectDefined(created.data, `${input.name} created`).event.id;
}

/** Deletes these season events with their rounds and tiers, once the Clutch Card events naming them are gone. */
export async function deleteSeasonEvents(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getFunctionalPrisma();
  const where = { sportEventId: { in: [...ids] } };
  await db.sportEventRound.deleteMany({ where });
  await db.sportEventTier.deleteMany({ where });
  const events = await db.sportEvent.findMany({ where: { id: { in: [...ids] } }, select: { eventSeriesId: true } });
  await db.sportEvent.deleteMany({ where: { id: { in: [...ids] } } });
  await db.eventSeries.deleteMany({ where: { id: { in: events.map((event) => event.eventSeriesId) }, sportEvents: { none: {} } } });
}
