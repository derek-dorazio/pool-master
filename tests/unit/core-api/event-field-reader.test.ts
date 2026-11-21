import { expect, jest } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '@poolmaster/shared/db';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import { EventFieldReader } from '../../../packages/core-api/src/modules/events/event-field-reader';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// An event's field as the contest and email readers read it (#1163, #1315), against an in-memory
// store: now, from the container's cache, or batched for a fan-out.

const T0 = new Date('2026-10-28T20:00:00.000Z');

function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const sportLeagueId = store.addSportLeague(sport.id).id;
  const masters = store.addEvent({ sportLeagueId, sport: Sport.GOLF });
  const open = store.addEvent({ sportLeagueId, sport: Sport.GOLF });
  const ana = store.addToField(masters.id, store.addParticipant(sport.id, 'Ana').id, { seedNumber: 2 });
  store.addToField(masters.id, store.addParticipant(sport.id, 'Ben').id, { seedNumber: 1 });
  store.addToField(open.id, store.addParticipant(sport.id, 'Cy').id, { seedNumber: 1 });
  const sportEvents = store.sportEventRepo();
  const field = store.fieldRepo();
  const reader = new EventFieldReader({ sportEvents, field, fieldCache: new ReadCache<SportEventParticipantView[]>(), now: () => T0 });
  return { store, masters, open, ana, sportEvents, field, reader };
}

const names = (rows: readonly SportEventParticipantView[]) => rows.map((row) => row.participant.name);

describe('EventFieldReader', () => {
  it('reads an event\'s field now in seed order, and refuses an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { masters, reader } = setup();

    expect(names(await reader.listEventParticipants(masters.id))).toEqual(['Ben', 'Ana']);
    await expect(reader.listEventParticipants('missing-event')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });

  it('answers a cached read from the field it read last, until the cache forgets it', async () => {
    const { masters, ana, reader } = setup();

    await reader.listCachedEventParticipants(masters.id);
    ana.seedNumber = 0;

    expect(names(await reader.listCachedEventParticipants(masters.id))).toEqual(['Ben', 'Ana']);
    expect(names(await reader.listEventParticipants(masters.id))).toEqual(['Ana', 'Ben']);
  });

  it('reads the fields a fan-out asks for together in one read of their events and one of their rows, each event\'s own rows answered to it', async () => {
    const { masters, open, sportEvents, field, reader } = setup();
    const findByIds = jest.spyOn(sportEvents, 'findByIds');
    const findFieldsForEvents = jest.spyOn(field, 'findFieldsForEvents');
    const batched = reader.batchedFieldReads();

    const [mastersField, openField] = await Promise.all([batched.listEventParticipants(masters.id), batched.listCachedEventParticipants(open.id)]);

    expect([names(mastersField), names(openField)]).toEqual([['Ben', 'Ana'], ['Cy']]);
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findFieldsForEvents).toHaveBeenCalledTimes(1);
    expect(batched.batchedFieldReads()).toBe(batched);
  });

  it('keeps a cache of its own on the wall clock when none is shared with it', async () => {
    const { masters, ana, sportEvents, field } = setup();
    const reader = new EventFieldReader({ sportEvents, field });

    await reader.listCachedEventParticipants(masters.id);
    ana.seedNumber = 0;

    expect(names(await reader.listCachedEventParticipants(masters.id))).toEqual(['Ben', 'Ana']);
    expect(names(await reader.batchedFieldReads().listCachedEventParticipants(masters.id))).toEqual(['Ben', 'Ana']);
  });

  it('refuses a fan-out that names an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { masters, reader } = setup();
    const batched = reader.batchedFieldReads();

    await expect(Promise.all([batched.listEventParticipants(masters.id), batched.listEventParticipants('missing-event')]))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});
