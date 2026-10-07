import { expect } from '@jest/globals';
import { MANUAL_ADMIN_PROVIDER_ID, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import {
  fakeContestEntryRepo,
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeSquadMembershipRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';

/** Before every event's start in this file, so the release cutoff never depends on today. */
const NOW = new Date('2026-01-15T12:00:00.000Z');

// SportEventService's own rules — where an event's sport comes from, what creation seeds,
// and what update and delete refuse — against an in-memory store. The adapters behind the
// same ports are tested against Postgres in sport-event-repositories.integration.

function setup(sportName: Sport = Sport.GOLF) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  const sportEvents = store.sportEventRepo();
  // The real lifecycle over the same store: a release is a status change like any other.
  const lifecycle = new EventLifecycleService(
    {
      contests: fakeContestRepo(),
      entries: fakeContestEntryRepo(),
      leagues: fakeLeagueRepo(),
      memberships: fakeLeagueMembershipRepo(),
      squadMemberships: fakeSquadMembershipRepo(),
      users: fakeUserRepo(),
    },
    sportEvents,
  );
  const service = new SportEventService({
    sportEvents,
    eventSeries: store.eventSeriesRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ sportEvents, tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo() }),
    lifecycle,
    now: () => NOW,
  });
  return { store, service, sportLeague };
}

const MANUAL_INPUT = {
  name: 'Harbour Open',
  startDate: new Date('2026-06-04T12:00:00.000Z'),
};

describe('SportEventService.createEvent', () => {
  it('creates a golf event with the manual identity, as a DRAFT, no provider data, four rounds and six tiers', async () => {
    const { store, service, sportLeague } = setup();

    const created = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });

    expect(created.event).toMatchObject({
      sport: Sport.GOLF,
      providerId: MANUAL_ADMIN_PROVIDER_ID,
      status: SportEventStatus.DRAFT,
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

  it('creates the event as a DRAFT linked to its provider for scores, with the schedule the provider dates imply', async () => {
    const { store, service, sportLeague } = setup();

    const created = await service.createEventFromProviderEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', externalId: 'ev-1', providerEvent });

    expect(created.event).toMatchObject({
      providerId: 'feed',
      externalId: 'ev-1',
      syncScope: 'SCORES_ONLY',
      status: SportEventStatus.DRAFT,
      name: 'Provider Classic',
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

// #385: a tour's provider slate for a year, imported in one action and safe to run again.
describe('SportEventService.importProviderEventYear', () => {
  const slate = [
    { externalId: 'pga-2026-a', name: 'Alpha Open', venue: 'A Links', startDate: new Date('2026-03-05T12:00:00.000Z'), endDate: new Date('2026-03-08T23:00:00.000Z') },
    { externalId: 'pga-2026-b', name: 'Bravo Classic', venue: null, startDate: new Date('2026-04-09T12:00:00.000Z'), endDate: new Date('2026-04-12T23:00:00.000Z') },
    { externalId: 'pga-2026-c', name: 'Harbour Open', venue: null, startDate: new Date('2026-06-04T12:00:00.000Z'), endDate: new Date('2026-06-07T23:00:00.000Z') },
  ];

  it('creates every provider event the tour lacks, each linked to its provider event for scores with four rounds', async () => {
    const { service, sportLeague } = setup();

    const result = await service.importProviderEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', providerEvents: slate });

    expect(result.skipped).toEqual([]);
    expect(result.created.map(({ event }) => ({ externalId: event.externalId, syncScope: event.syncScope, eventYear: event.eventYear, rounds: event.rounds })))
      .toEqual(slate.map(({ externalId }) => ({ externalId, syncScope: 'SCORES_ONLY', eventYear: 2026, rounds: 4 })));
  });

  it('skips an event already linked to the provider event and a series that already has an edition that year, creating only the rest', async () => {
    const { store, service, sportLeague } = setup();
    store.addEvent({ providerId: 'feed', externalId: 'pga-2026-a' });
    await service.createEvent({ ...MANUAL_INPUT, sportLeagueId: sportLeague.id, eventYear: 2026 });

    const result = await service.importProviderEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', providerEvents: slate });

    expect(result.created.map(({ event }) => event.externalId)).toEqual(['pga-2026-b']);
    expect(result.skipped).toEqual([
      { externalId: 'pga-2026-a', name: 'Alpha Open', reason: 'ALREADY_LINKED' },
      { externalId: 'pga-2026-c', name: 'Harbour Open', reason: 'EDITION_EXISTS' },
    ]);
  });

  it('creates nothing on a second run, reporting every event as already linked', async () => {
    const { service, sportLeague } = setup();
    await service.importProviderEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', providerEvents: slate });

    const again = await service.importProviderEventYear({ sportLeagueId: sportLeague.id, eventYear: 2026, providerId: 'feed', providerEvents: slate });

    expect(again.created).toEqual([]);
    expect(again.skipped.map((row) => row.reason)).toEqual(['ALREADY_LINKED', 'ALREADY_LINKED', 'ALREADY_LINKED']);
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

describe('SportEventService.releaseEvent (#431)', () => {
  /** A draft whose field holds `golfers` active golfers, the first `tiered` of them in a tier. */
  async function draftWithField(store: InMemorySportEvents, golfers: number, tiered: number, overrides: Parameters<InMemorySportEvents['addEvent']>[0] = {}) {
    const event = store.addEvent({ status: SportEventStatus.DRAFT, ...overrides });
    await store.tierRepo().createMany(event.id, [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 }]);
    const tierId = store.tierRows[0].id;
    const entries = Array.from({ length: golfers }, (_, index) => store.addToField(event.id, `participant-${index}`));
    await store.valuationRepo().assignTiers(entries.slice(0, tiered).map((entry, index) => ({
      sportEventParticipantId: entry.id,
      sportEventTierId: tierId,
      tierOrderIndex: index + 1,
      source: 'MANUAL',
    })));
    return event;
  }

  it('releases a draft with a loaded, fully tiered field before its start: DRAFT becomes SCHEDULED', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3);

    const released = await service.releaseEvent(event.id);

    expect(released.event.status).toBe(SportEventStatus.SCHEDULED);
    expect(store.events[0].status).toBe(SportEventStatus.SCHEDULED);
  });

  it('refuses a draft whose field is empty with 422 SPORT_EVENT_NOT_READY, leaving it a draft', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 0, 0);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_READY', statusCode: 422 });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses a draft with an active golfer in no tier with 422 SPORT_EVENT_NOT_READY', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 2);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('1 active participant(s) have no tier'),
    });
  });

  it('ignores a withdrawn golfer with no tier: only active golfers must be tiered', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 2, 2);
    const withdrawn = store.addToField(event.id, 'participant-withdrawn');
    withdrawn.isActive = false;

    await expect(service.releaseEvent(event.id)).resolves.toMatchObject({ event: { status: SportEventStatus.SCHEDULED } });
  });

  it('refuses a draft whose start time has passed with 409 SPORT_EVENT_ALREADY_STARTED', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, { startDate: new Date('2026-01-15T12:00:00.000Z') });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 409 });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses an event that is already released with 409 SPORT_EVENT_NOT_DRAFT, and an unknown one with 404', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, { status: SportEventStatus.SCHEDULED });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_DRAFT', statusCode: 409 });
    await expect(service.releaseEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService — read, update, delete', () => {
  it('lists events with their field, tier and contest counts, zero where there are none', async () => {
    const { store, service } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');

    const [summary] = await service.listEvents({});

    expect(summary).toMatchObject({ loadedParticipantCount: 1, untieredParticipantCount: 1, tierCount: 0, contestCount: 2 });
    await expect(service.getEvent('missing')).resolves.toBeNull();
  });

  it('updates an admin-managed event, clearing a field set to null', async () => {
    const { store, service } = setup();
    const event = store.addEvent({ venue: 'Old Course' });

    const updated = await service.updateEvent(event.id, { name: 'Renamed', venue: null });

    expect(updated.event).toMatchObject({ name: 'Renamed', venue: undefined });
  });

  it('edits an event linked to a provider for scores, since every event is admin-owned, and 404s an unknown one', async () => {
    const { store, service } = setup();
    const linked = store.addEvent({ syncScope: 'SCORES_ONLY' });

    await expect(service.updateEvent(linked.id, { name: 'Renamed Open' })).resolves.toMatchObject({ event: { name: 'Renamed Open' } });
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

describe('SportEventService.updateEvent keeps the round schedule in step with the event', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function roundsOf(store: InMemorySportEvents, sportEventId: string) {
    return store.roundRows
      .filter((round) => round.sportEventId === sportEventId)
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({ roundNumber: round.roundNumber, scheduledDate: round.scheduledDate.toISOString() }));
  }

  it('schedules the added rounds a day apart when an admin raises the round count, so their live scores are kept', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, rounds: 3 });

    await service.updateEvent(event.id, { rounds: 4 });

    expect(roundsOf(store, event.id)).toEqual([
      { roundNumber: 1, scheduledDate: '2026-06-04T12:00:00.000Z' },
      { roundNumber: 2, scheduledDate: '2026-06-05T12:00:00.000Z' },
      { roundNumber: 3, scheduledDate: '2026-06-06T12:00:00.000Z' },
      { roundNumber: 4, scheduledDate: '2026-06-07T12:00:00.000Z' },
    ]);
  });

  it('moves every round by the same amount when an admin moves the start date, so automatic lifecycle starts it on the new date', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, rounds: 2 });
    // An irregular schedule the admin set: round 2 two days after round 1.
    await new SportEventRoundService({ rounds: store.roundRepo() }).reschedule(event.id, [
      { roundNumber: 2, scheduledDate: new Date(MANUAL_INPUT.startDate.getTime() + 2 * DAY) },
    ]);

    await service.updateEvent(event.id, { startDate: new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY) });

    expect(roundsOf(store, event.id)).toEqual([
      { roundNumber: 1, scheduledDate: '2026-06-11T12:00:00.000Z' },
      { roundNumber: 2, scheduledDate: '2026-06-13T12:00:00.000Z' },
    ]);
  });

  it('leaves the round schedule alone when an edit changes neither the start date nor the round count', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, rounds: 2 });
    const before = roundsOf(store, event.id);

    await service.updateEvent(event.id, { name: 'Renamed', startDate: MANUAL_INPUT.startDate, rounds: 2 });

    expect(roundsOf(store, event.id)).toEqual(before);
  });
});
