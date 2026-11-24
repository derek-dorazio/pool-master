import { expect } from '@jest/globals';
import { testDomainEvents } from '../../support/domain-events';
import { ScoringFamily, Sport, type SportEvent } from '@poolmaster/shared/domain';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { fakeContestConfigurationRepo, fakeContestRepo } from '../../support/repo-fakes';
import { NO_SETTLE_JOBS } from '../../support/event-settlement';

// #1820: every Clutch Card event created names its season event (the World Series round of the
// MLB Postseason) and the rounds of it the league covers; no other event names one. The service
// rules against an in-memory store; the columns, the check constraints and the backfill are
// tested against Postgres in clutch-card-parent-event.integration.

const POSTSEASON = {
  sport: Sport.BASEBALL,
  name: 'MLB Postseason',
  rounds: 4,
  eventYear: 2025,
  startDate: new Date('2025-09-30T17:00:00.000Z'),
  endDate: new Date('2025-11-02T04:00:00.000Z'),
};

const WORLD_SERIES = {
  eventYear: 2025,
  name: 'World Series',
  startDate: new Date('2025-10-24T23:00:00.000Z'),
  endDate: new Date('2025-11-02T04:00:00.000Z'),
  rounds: 7,
};

function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.BASEBALL);
  const mlb = store.addSportLeague(sport.id, 'MLB');
  const worldSeries = Object.assign(store.addSportLeague(sport.id, 'World Series'), {
    scoringFamily: ScoringFamily.COMPOSITE,
    parentSportLeagueId: mlb.id,
    parentRoundNumbers: [4],
  });
  const sportEvents = store.sportEventRepo();
  const lifecycle = new EventLifecycleService(
    { contests: fakeContestRepo(), configurations: fakeContestConfigurationRepo(), matches: store.matchRepo() },
    sportEvents,
    testDomainEvents(),
    NO_SETTLE_JOBS,
  );
  const service = new SportEventService({ domainEvents: testDomainEvents(),
    sportEvents,
    eventSeries: store.eventSeriesRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ sportEvents, tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo(), participants: store.participantRepo(), tierProfiles: store.tierProfileRepo(), pricingProfiles: store.pricingProfileRepo() }),
    bracket: new SportEventBracketService({ domainEvents: testDomainEvents(),
      sportEvents,
      sportLeagues: store.sportLeagueRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      matches: store.matchRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      ...NO_PICKS_ON_EVENT,
      contests: { recheckReminders: async () => undefined },
    }),
    lifecycle,
    contests: { recheckReminders: async () => undefined },
    // Before every event's start here: an event is created from a provider only before it starts.
    now: () => new Date('2025-09-01T12:00:00.000Z'),
  });
  const addPostseason = (overrides: Partial<SportEvent> = {}): SportEvent => store.addEvent({ ...POSTSEASON, sportLeagueId: mlb.id, ...overrides });
  return { store, service, mlb, worldSeries, addPostseason };
}

describe('SportEventService links each new Clutch Card event to its season event (#1820)', () => {
  it('links a created Clutch Card event to the parent league event under way at its start, with the league\'s rounds', async () => {
    const { service, worldSeries, addPostseason } = setup();
    const postseason = addPostseason();

    const created = await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    expect(created.event.parentEvent).toEqual({ id: postseason.id, name: 'MLB Postseason', roundNumbers: [4] });
  });

  it('takes a parent event with no end date yet as under way from its start', async () => {
    const { service, worldSeries, addPostseason } = setup();
    const postseason = addPostseason({ endDate: undefined });

    const created = await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    expect(created.event.parentEvent?.id).toBe(postseason.id);
  });

  it('does not count a parent league event with no end date that started over a year before as under way', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason({ eventYear: 2024, startDate: new Date('2024-10-01T17:00:00.000Z'), endDate: undefined });

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_FOUND', statusCode: 422 });
  });

  it('refuses a Clutch Card event with no parent league event under way at its start with 422 PARENT_EVENT_NOT_FOUND, creating nothing', async () => {
    const { store, service, worldSeries, addPostseason } = setup();
    // Last season's postseason, long over, and next season's, not yet begun.
    addPostseason({ eventYear: 2024, startDate: new Date('2024-10-01T17:00:00.000Z'), endDate: new Date('2024-10-31T04:00:00.000Z') });
    addPostseason({ eventYear: 2026, startDate: new Date('2026-09-29T17:00:00.000Z'), endDate: new Date('2026-11-01T04:00:00.000Z') });

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_FOUND', statusCode: 422 });
    expect(store.events.filter((event) => event.name === 'World Series')).toEqual([]);
  });

  it('passes over a parent league event without the rounds the league covers, refusing with PARENT_EVENT_NOT_FOUND', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason({ rounds: 3 });

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_FOUND', statusCode: 422 });
  });

  it('refuses when two parent league events are under way at the start with 422 PARENT_EVENT_AMBIGUOUS', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason();
    addPostseason({ name: 'MLB Postseason (copy)' });

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_AMBIGUOUS', statusCode: 422 });
  });

  it('links to the season event of the Clutch Card event\'s own year when a test season event of another year is under way too', async () => {
    const { service, worldSeries, addPostseason } = setup();
    // QA's test seed: last season's postseason, its dates moved onto this season's.
    addPostseason({ name: 'Test- MLB Postseason', eventYear: 2024, startDate: new Date('2025-10-01T12:00:00.000Z'), endDate: new Date('2025-11-03T12:00:00.000Z') });
    const real = addPostseason();

    const created = await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    expect(created.event.parentEvent?.id).toBe(real.id);
  });

  it('passes over a cancelled season event', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason({ status: 'CANCELLED' });
    const kept = addPostseason({ name: 'MLB Postseason (rescheduled)', eventYear: 2024 });

    const created = await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    expect(created.event.parentEvent?.id).toBe(kept.id);
  });

  it('links to the parent event the caller names, whatever its dates, when it is a parent league event with the rounds', async () => {
    const { service, worldSeries, addPostseason } = setup();
    const named = addPostseason({ startDate: new Date('2027-01-04T12:00:00.000Z'), endDate: new Date('2027-02-04T12:00:00.000Z') });

    const created = await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES, parentEventId: named.id });

    expect(created.event.parentEvent).toEqual({ id: named.id, name: 'MLB Postseason', roundNumbers: [4] });
  });

  it('refuses a named parent of another league, or one without the rounds, with 422 PARENT_EVENT_MISMATCH, and an unknown one with PARENT_EVENT_NOT_FOUND', async () => {
    const { store, service, worldSeries, addPostseason } = setup();
    const otherLeague = store.addEvent({ ...POSTSEASON, sportLeagueId: worldSeries.id, name: 'World Series 2024' });
    const tooShort = addPostseason({ rounds: 2 });

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES, parentEventId: otherLeague.id }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_MISMATCH', statusCode: 422 });
    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES, parentEventId: tooShort.id }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_MISMATCH', statusCode: 422 });
    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES, parentEventId: 'event-missing' }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_FOUND', statusCode: 422 });
  });

  it('gives an event of any other league no parent, and refuses one named for it with 422 PARENT_EVENT_NOT_ALLOWED', async () => {
    const { service, mlb, addPostseason } = setup();
    const other = addPostseason();

    const created = await service.createEvent({ sportLeagueId: mlb.id, ...POSTSEASON, eventYear: 2026, startDate: new Date('2026-09-29T17:00:00.000Z'), endDate: undefined });
    expect(created.event.parentEvent).toBeUndefined();

    await expect(service.createEvent({ sportLeagueId: mlb.id, ...POSTSEASON, eventYear: 2027, parentEventId: other.id }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_ALLOWED', statusCode: 422 });
  });

  it('refuses every event of a Clutch Card league that names no parent league and rounds with 422 CLUTCH_CARD_PARENT_NOT_CONFIGURED', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason();
    worldSeries.parentRoundNumbers = [];

    await expect(service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES }))
      .rejects.toMatchObject({ code: 'CLUTCH_CARD_PARENT_NOT_CONFIGURED', statusCode: 422 });
  });

  it('links an event created from a provider event the same way', async () => {
    const { service, worldSeries, addPostseason } = setup();
    const postseason = addPostseason();

    const created = await service.createEventFromProviderEvent({
      sportLeagueId: worldSeries.id,
      eventYear: 2025,
      providerId: 'balldontlie',
      externalId: 'mlb-2025-postseason-round-4',
      providerEvent: { name: 'World Series', venue: null, startDate: WORLD_SERIES.startDate, endDate: WORLD_SERIES.endDate },
    });

    expect(created.event.parentEvent?.id).toBe(postseason.id);
  });

  it('imports the provider Clutch Card events whose season event is on the site, linked, and skips the rest as NO_PARENT_EVENT', async () => {
    const { service, worldSeries, addPostseason } = setup();
    const postseason = addPostseason();

    const result = await service.importProviderEventYear({
      sportLeagueId: worldSeries.id,
      eventYear: 2025,
      providerId: 'balldontlie',
      providerEvents: [
        { externalId: 'mlb-2025-postseason-round-4', name: 'World Series', venue: null, startDate: WORLD_SERIES.startDate, endDate: WORLD_SERIES.endDate },
        { externalId: 'mlb-2026-postseason-round-4', name: 'World Series 2026', venue: null, startDate: new Date('2026-10-23T23:00:00.000Z'), endDate: null },
      ],
    });

    expect(result.created.map(({ event }) => [event.externalId, event.parentEvent?.id])).toEqual([['mlb-2025-postseason-round-4', postseason.id]]);
    expect(result.skipped).toEqual([{ externalId: 'mlb-2026-postseason-round-4', name: 'World Series 2026', reason: 'NO_PARENT_EVENT' }]);
  });

  it('links each cloned Clutch Card event to the target year\'s season event, and refuses the clone while that year has none', async () => {
    const { service, worldSeries, addPostseason } = setup();
    addPostseason();
    await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    await expect(service.cloneEventYear({ sportLeagueId: worldSeries.id, eventYear: 2025 }))
      .rejects.toMatchObject({ code: 'PARENT_EVENT_NOT_FOUND', statusCode: 422 });

    const next = addPostseason({ eventYear: 2026, startDate: new Date('2026-09-29T17:00:00.000Z'), endDate: new Date('2026-11-01T04:00:00.000Z') });
    const cloned = await service.cloneEventYear({ sportLeagueId: worldSeries.id, eventYear: 2025 });

    expect(cloned.map(({ event }) => event.parentEvent?.id)).toEqual([next.id]);
  });

  it('refuses to delete a season event a Clutch Card event names with 409 EVENT_HAS_CLUTCH_CARD_EVENTS, keeping both', async () => {
    const { store, service, worldSeries, addPostseason } = setup();
    const postseason = addPostseason();
    await service.createEvent({ sportLeagueId: worldSeries.id, ...WORLD_SERIES });

    await expect(service.deleteEvent(postseason.id))
      .rejects.toMatchObject({ code: 'EVENT_HAS_CLUTCH_CARD_EVENTS', statusCode: 409 });
    expect(store.events).toHaveLength(2);
  });
});
