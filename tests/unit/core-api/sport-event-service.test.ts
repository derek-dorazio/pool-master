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
  const season = store.addSeason(sportLeague.id);
  const service = new SportEventService({
    sportEvents: store.sportEventRepo(),
    eventSeries: store.eventSeriesRepo(),
    seasons: store.seasonRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo() }),
  });
  return { store, service, season, sportLeague };
}

const MANUAL_INPUT = {
  name: 'Harbour Open',
  startDate: new Date('2026-06-04T12:00:00.000Z'),
  releaseAt: new Date('2026-05-21T12:00:00.000Z'),
  fieldLocksAt: new Date('2026-06-03T12:00:00.000Z'),
};

describe('SportEventService.createEvent', () => {
  it('creates a golf event with the manual identity, SCHEDULED, no provider data, four rounds and six tiers', async () => {
    const { store, service, season } = setup();

    const created = await service.createEvent({ seasonId: season.id, ...MANUAL_INPUT });

    expect(created.event).toMatchObject({
      sport: Sport.GOLF,
      providerId: MANUAL_ADMIN_PROVIDER_ID,
      status: SportEventStatus.SCHEDULED,
      syncScope: 'NONE',
      rounds: 4,
      seasonId: season.id,
    });
    expect(created.event.externalId).toMatch(/^manual-/);
    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    // The summary is read after the rounds and tiers exist, so its counts include them.
    expect(created.tierCount).toBe(6);
  });

  it('resolves the event to its season\'s recurring league event by name, creating it once', async () => {
    const { store, service, season } = setup();

    const first = await service.createEvent({ seasonId: season.id, ...MANUAL_INPUT });
    const second = await service.createEvent({ seasonId: season.id, ...MANUAL_INPUT, rounds: 2 });

    expect(second.event.eventSeriesId).toBe(first.event.eventSeriesId);
    expect(store.eventSeriesRows).toHaveLength(1);
  });

  it('refuses a season whose sport league is not golf with 422, rather than creating a golf event', async () => {
    const { service, season } = setup(Sport.NBA);

    await expect(service.createEvent({ seasonId: season.id, ...MANUAL_INPUT }))
      .rejects.toMatchObject({ code: 'SPORT_NOT_SUPPORTED', statusCode: 422 });
  });

  it('fails with 404 SEASON_NOT_FOUND for an unknown season', async () => {
    const { service } = setup();

    await expect(service.createEvent({ seasonId: 'missing', ...MANUAL_INPUT }))
      .rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
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
    const { store, service, season } = setup();

    const created = await service.createEventFromProviderEvent({ seasonId: season.id, providerId: 'feed', externalId: 'ev-1', providerEvent });

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
    const { store, service, season } = setup();

    const created = await service.createEventFromProviderEvent({ seasonId: season.id, providerId: 'feed', externalId: 'ev-1', rounds: 2, providerEvent });

    expect(created.event.rounds).toBe(2);
    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2]);
  });

  it('refuses a provider identity another event already holds with 409 EXTERNAL_EVENT_ALREADY_LINKED', async () => {
    const { store, service, season } = setup();
    store.addEvent({ providerId: 'feed', externalId: 'ev-1' });

    await expect(service.createEventFromProviderEvent({ seasonId: season.id, providerId: 'feed', externalId: 'ev-1', providerEvent }))
      .rejects.toMatchObject({ code: 'EXTERNAL_EVENT_ALREADY_LINKED', statusCode: 409 });
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
