import { expect } from '@jest/globals';
import { MANUAL_ADMIN_PROVIDER_ID, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// SportEventService's own rules — where an event's sport comes from, what creation seeds,
// and what update and delete refuse — against an in-memory store. The adapters behind the
// same ports are tested against Postgres in sport-event-repositories.integration.

function setup(sportName: Sport = Sport.GOLF) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  const service = new SportEventService({
    sportEvents: store.sportEventRepo(),
    eventSeries: store.eventSeriesRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo() }),
  });
  return { store, service, sportLeague };
}

const MANUAL_INPUT = {
  name: 'Harbour Open',
  startDate: new Date('2026-06-04T12:00:00.000Z'),
  releaseAt: new Date('2026-05-21T12:00:00.000Z'),
  fieldLocksAt: new Date('2026-06-03T12:00:00.000Z'),
};

describe('SportEventService.createEvent', () => {
  it('creates a golf event with the manual identity, SCHEDULED, no provider data, four rounds and six tiers', async () => {
    const { store, service, sportLeague } = setup();

    const created = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });

    expect(created.event).toMatchObject({
      sport: Sport.GOLF,
      providerId: MANUAL_ADMIN_PROVIDER_ID,
      status: SportEventStatus.SCHEDULED,
      syncScope: 'NONE',
      rounds: 4,
      sportLeagueId: sportLeague.id,
      eventYear: 2026,
    });
    expect(created.event.externalId).toMatch(/^manual-/);
    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    // The summary is read after the rounds and tiers exist, so its counts include them.
    expect(created.tierCount).toBe(6);
  });

  it('resolves the event to its sport league\'s series by name, creating the series once', async () => {
    const { store, service, sportLeague } = setup();

    const first = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });
    const second = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2027, ...MANUAL_INPUT, rounds: 2 });

    expect(second.event.eventSeriesId).toBe(first.event.eventSeriesId);
    expect(store.eventSeriesRows).toHaveLength(1);
  });

  // plans/147 decision 5 — one edition of a series per year. The store raises the database's
  // unique violation; the service turns it into a 409 rather than a 500.
  it('refuses a second edition of a series in one year with 409 EVENT_EDITION_ALREADY_EXISTS', async () => {
    const { store, service, sportLeague } = setup();
    await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });

    await expect(service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT }))
      .rejects.toMatchObject({ code: 'EVENT_EDITION_ALREADY_EXISTS', statusCode: 409 });
    expect(store.events).toHaveLength(1);
  });

  it('refuses a sport league that is not golf with 422, rather than creating a golf event', async () => {
    const { service, sportLeague } = setup(Sport.NBA);

    await expect(service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT }))
      .rejects.toMatchObject({ code: 'SPORT_NOT_SUPPORTED', statusCode: 422 });
  });

  it('fails with 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league', async () => {
    const { service } = setup();

    await expect(service.createEvent({ sportLeagueId: 'missing', eventYear: 2026, ...MANUAL_INPUT }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService.createEventFromProviderEvent', () => {
  const providerEvent = {
    name: 'Provider Classic',
    venue: 'Links',
    startDate: new Date('2026-07-16T12:00:00.000Z'),
    endDate: new Date('2026-07-19T12:00:00.000Z'),
  };

  it('creates the event linked to its provider for scores, released and locked at its start, with the schedule the provider dates imply', async () => {
    const { store, service, sportLeague } = setup();

    const created = await service.createEventFromProviderEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', externalId: 'ev-1', providerEvent });

    expect(created.event).toMatchObject({
      providerId: 'feed',
      externalId: 'ev-1',
      syncScope: 'SCORES_ONLY',
      name: 'Provider Classic',
      releaseAt: providerEvent.startDate,
      fieldLocksAt: providerEvent.startDate,
      rounds: 4,
    });
    expect(store.roundRows.map((round) => round.scheduledDate.toISOString().slice(0, 10)))
      .toEqual(['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19']);
  });

  it('uses sequential days from the start when a round count is given', async () => {
    const { store, service, sportLeague } = setup();

    const created = await service.createEventFromProviderEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', externalId: 'ev-1', rounds: 2, providerEvent });

    expect(created.event.rounds).toBe(2);
    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2]);
  });

  it('refuses a provider identity another event already holds with 409 EXTERNAL_EVENT_ALREADY_LINKED', async () => {
    const { store, service, sportLeague } = setup();
    store.addEvent({ providerId: 'feed', externalId: 'ev-1' });

    await expect(service.createEventFromProviderEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', externalId: 'ev-1', providerEvent }))
      .rejects.toMatchObject({ code: 'EXTERNAL_EVENT_ALREADY_LINKED', statusCode: 409 });
  });
});

// plans/124 §4.2a, reshaped by plans/147: cloning a season became cloning a sport league's
// event year — the same calendar copy, keyed by (sport league, year) instead of a season row.
describe('SportEventService.cloneEventYear', () => {
  it('re-creates each event of the year a year on (leap-year safe), as next year\'s edition of the same series', async () => {
    const { store, service, sportLeague } = setup();
    const source = await service.createEvent({
      sportLeagueId: sportLeague.id, eventYear: 2024, name: 'The Open', venue: 'Royal Liverpool', rounds: 4,
      startDate: new Date('2024-02-29T00:00:00.000Z'), endDate: new Date('2024-03-03T00:00:00.000Z'),
      releaseAt: new Date('2024-02-15T00:00:00.000Z'), fieldLocksAt: new Date('2024-02-28T00:00:00.000Z'),
    });

    const cloned = await service.cloneEventYear({ sportLeagueId: sportLeague.id, eventYear: 2024 });

    expect(cloned).toHaveLength(1);
    expect(cloned[0].event).toMatchObject({
      name: 'The Open',
      venue: 'Royal Liverpool',
      eventYear: 2025,
      eventSeriesId: source.event.eventSeriesId,
      // Feb 29 lands on Mar 1 in the non-leap year.
      startDate: new Date('2025-03-01T00:00:00.000Z'),
      endDate: new Date('2025-03-03T00:00:00.000Z'),
    });
    expect(store.events).toHaveLength(2);
  });

  it('honours an explicit target year, and refuses one that already has events with 409 before creating anything', async () => {
    const { store, service, sportLeague } = setup();
    await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });

    await expect(service.cloneEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, targetYear: 2028 }))
      .resolves.toEqual([expect.objectContaining({ event: expect.objectContaining({ eventYear: 2028 }) })]);

    await expect(service.cloneEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, targetYear: 2028 }))
      .rejects.toMatchObject({ code: 'EVENT_YEAR_NOT_EMPTY', statusCode: 409 });
    expect(store.events).toHaveLength(2);
  });

  it('refuses an empty source year with 422 EVENT_YEAR_HAS_NO_EVENTS, and an unknown sport league with 404', async () => {
    const { service, sportLeague } = setup();

    await expect(service.cloneEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026 }))
      .rejects.toMatchObject({ code: 'EVENT_YEAR_HAS_NO_EVENTS', statusCode: 422 });
    await expect(service.cloneEventYear({ sportLeagueId: 'missing', eventYear: 2026 }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService — read, update, delete', () => {
  it('lists events with their field, tier and contest counts, zero where there are none', async () => {
    const { store, service } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');

    const [summary] = await service.listEvents({});

    expect(summary).toMatchObject({ loadedParticipantCount: 1, tierCount: 0, contestCount: 2 });
    await expect(service.getEvent('missing')).resolves.toBeNull();
  });

  it('updates an admin-managed event, clearing a field set to null', async () => {
    const { store, service } = setup();
    const event = store.addEvent({ venue: 'Old Course' });

    const updated = await service.updateEvent(event.id, { name: 'Renamed', venue: null });

    expect(updated.event).toMatchObject({ name: 'Renamed', venue: undefined });
  });

  it('refuses to edit an event a provider owns in full with 409, and an unknown one with 404', async () => {
    const { store, service } = setup();
    const owned = store.addEvent({ syncScope: 'FULL' });

    await expect(service.updateEvent(owned.id, { name: 'x' })).rejects.toMatchObject({ code: 'EVENT_NOT_ADMIN_MANAGED', statusCode: 409 });
    await expect(service.updateEvent('missing', { name: 'x' })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });

  it('deletes an event with no contests, and refuses one with contests with 409 EVENT_HAS_CONTESTS', async () => {
    const { store, service } = setup();
    const free = store.addEvent();
    const busy = store.addEvent();
    store.contestsByEvent.set(busy.id, 1);

    await service.deleteEvent(free.id);

    expect(store.events.map((event) => event.id)).toEqual([busy.id]);
    await expect(service.deleteEvent(busy.id)).rejects.toMatchObject({ code: 'EVENT_HAS_CONTESTS', statusCode: 409 });
    await expect(service.deleteEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});
