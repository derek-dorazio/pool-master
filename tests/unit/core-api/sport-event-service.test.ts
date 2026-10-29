import { expect } from '@jest/globals';
import { MANUAL_ADMIN_PROVIDER_ID, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import type { SportEventChangedNotice } from '../../../packages/core-api/src/modules/notifications';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { SportEventParticipantService } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { EventScoreSourceService } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { createEventHandlers } from '../../../packages/core-api/src/modules/events/handler';
import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { RaceResultService } from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import { StatLineService } from '../../../packages/core-api/src/modules/scoring-families/composite/stat-line-service';
import { MatchResultService } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import { SportLeagueService } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import { asFastifyRequest } from '../../support/fastify-doubles';
import { stubInstance } from '../../support/stub-instance';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { standardEventPricing } from '../../support/budget-pricing';
import {
  fakeContestConfigurationRepo,
  fakeContestRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { fakeLogger } from '../../support/fake-logger';

/** Before every event's start in this file, so the release cutoff never depends on today. */
const NOW = new Date('2026-01-15T12:00:00.000Z');

// SportEventService's own rules — where an event's sport comes from, what creation seeds,
// and what update and delete refuse — against an in-memory store. The adapters behind the
// same ports are tested against Postgres in sport-event-repositories.integration.

function setup(sportName: Sport = Sport.GOLF, sportEventChanged?: SportEventChangedNotice) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  const sportEvents = store.sportEventRepo();
  // The real lifecycle over the same store: a release is a status change like any other.
  const lifecycle = new EventLifecycleService(
    {
      contests: fakeContestRepo(),
      configurations: fakeContestConfigurationRepo(),
      matches: store.matchRepo(),
    },
    sportEvents,
    undefined,
    undefined,
    undefined,
    undefined,
    sportEventChanged,
  );
  const service = new SportEventService({
    sportEvents,
    eventSeries: store.eventSeriesRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ sportEvents, tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo() }),
    bracket: new SportEventBracketService({
      sportEvents,
      sportLeagues: store.sportLeagueRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      affiliations: store.affiliationRepo(),
      matches: store.matchRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      ...NO_PICKS_ON_EVENT,
    }),
    lifecycle,
    now: () => NOW,
  });
  return { store, service, sportLeague, lifecycle, sportEvents };
}

/** An ordinary edit: a moved start of a released event is told to its leagues. */
const TELL = { tellMembers: true };

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
  /**
   * A draft whose field holds `golfers` active golfers, the first `tiered` of them in a tier and
   * the first `priced` of them priced with the Standard profile (all, unless `priced` says).
   * `priced: null` leaves the event with no prices assigned at all.
   */
  async function draftWithField(
    store: InMemorySportEvents,
    golfers: number,
    tiered: number,
    overrides: Parameters<InMemorySportEvents['addEvent']>[0] = {},
    priced: number | null = golfers,
  ) {
    const event = store.addEvent({ status: SportEventStatus.DRAFT, ...overrides });
    await store.tierRepo().createMany(event.id, [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 }]);
    const tierId = store.tierRows[0].id;
    const entries = Array.from({ length: golfers }, (_, index) => store.addToField(event.id, `participant-${index}`));
    await store.valuationRepo().assignTiers(entries.slice(0, tiered).map((entry, index) => ({
      sportEventParticipantId: entry.id,
      sportEventTierId: tierId,
      tierOrderIndex: index + 1,
      source: 'MANUAL',
    })));
    if (priced !== null) {
      await store.valuationRepo().assignEventPrices({
        sportEventId: event.id,
        pricingConfig: standardEventPricing(),
        assignments: entries.slice(0, priced).map((entry) => ({ sportEventParticipantId: entry.id, price: 6000, source: 'AUTO_RANKING' })),
      });
    }
    return event;
  }

  it('releases a draft with a loaded, fully tiered field before its start: DRAFT becomes SCHEDULED', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3);

    const released = await service.releaseEvent(event.id);

    expect(released.event.status).toBe(SportEventStatus.SCHEDULED);
    expect(store.events[0].status).toBe(SportEventStatus.SCHEDULED);
  });

  it('refuses a basketball draft whose bracket is not loaded with 422 SPORT_EVENT_NOT_READY, though its field is tiered and priced', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const event = await draftWithField(store, 2, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      statusCode: 422,
      message: expect.stringContaining('its bracket is not loaded'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('releases a basketball draft once its bracket holds every active team', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const event = await draftWithField(store, 2, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id });
    await store.roundRepo().createMany(event.id, [{ roundNumber: 1, scheduledDate: event.startDate }]);
    const [home, away] = store.field;
    await store.matchRepo().replaceBracket(event.id, [{
      id: 'final', roundNumber: 1, matchNumber: 1, homeSportEventParticipantId: home.id, awaySportEventParticipantId: away.id,
      isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSide: null, regionLabel: null,
    }]);

    await expect(service.releaseEvent(event.id)).resolves.toMatchObject({ event: { status: SportEventStatus.SCHEDULED } });
  });

  it('lists what a draft still needs before release in the refusal\'s words, a bracket sport\'s bracket included, and nothing once it is ready', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const unready = await draftWithField(store, 3, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id }, null);
    const golf = setup();
    const ready = await draftWithField(golf.store, 3, 3);

    await expect(service.releaseBlockersOf(unready.id)).resolves.toEqual([
      '1 active participant(s) have no tier',
      'its prices have not been assigned',
      expect.stringContaining('its bracket is not loaded'),
    ]);
    await expect(golf.service.releaseBlockersOf(ready.id)).resolves.toEqual([]);
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

  it('refuses a draft with a tier no active participant is in with 422 SPORT_EVENT_NOT_READY, naming the empty tier in the sport\'s words', async () => {
    const { store, service } = setup(Sport.AUTO_RACING);
    const event = await draftWithField(store, 3, 3, { sport: Sport.AUTO_RACING });
    await store.tierRepo().createMany(event.id, [{ tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 }]);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      statusCode: 422,
      message: expect.stringContaining('Tier 2 has no drivers'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('counts a tier holding only a withdrawn participant as empty, so the draft is not released', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 2, 2);
    await store.tierRepo().createMany(event.id, [{ tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 }]);
    const withdrawn = store.addToField(event.id, 'participant-withdrawn');
    withdrawn.isActive = false;
    const tier2Id = store.tierRows.filter((tier) => tier.tierKey === 'tier-2').map((tier) => tier.id)[0];
    await store.valuationRepo().assignTiers([{ sportEventParticipantId: withdrawn.id, sportEventTierId: tier2Id, tierOrderIndex: 3, source: 'MANUAL' }]);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('Tier 2 has no golfers'),
    });
  });

  it('refuses a draft whose prices were never assigned with 422 SPORT_EVENT_NOT_READY (#93)', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, {}, null);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('its prices have not been assigned'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses a draft with an active golfer who has no price with 422 SPORT_EVENT_NOT_READY (#93)', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, {}, 2);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('1 active participant(s) have no price'),
    });
  });

  it('ignores a withdrawn golfer with no tier or price: only active golfers must be tiered and priced', async () => {
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
  it('lists events with their field, tier and admin counts for a root admin\'s read, zero where there are none', async () => {
    const { store, service } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');

    const [summary] = await service.listEvents({ eventYear: event.eventYear }, { adminCounts: true });

    expect(summary).toMatchObject({
      loadedParticipantCount: 1,
      tierCount: 0,
      adminCounts: { untieredParticipantCount: 1, unpricedParticipantCount: 1, emptyTierLabels: [], contestCount: 2 },
    });
  });

  // #1198 — the admin counts are five more queries per read and count contests across every
  // league, so a member's read runs only the field and tier counts.
  it('lists events for a member with only the field and tier counts, never running the admin counts', async () => {
    const { store, service, sportEvents } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');
    const adminCounts = [
      jest.spyOn(sportEvents, 'countUntieredActiveParticipants'),
      jest.spyOn(sportEvents, 'countUnpricedActiveParticipants'),
      jest.spyOn(sportEvents, 'findEmptyTierLabels'),
      jest.spyOn(sportEvents, 'countContests'),
    ];

    const [summary] = await service.listEvents({ eventYear: event.eventYear }, { adminCounts: false });

    expect(summary).toMatchObject({ loadedParticipantCount: 1, tierCount: 0, adminCounts: null });
    for (const count of adminCounts) {
      expect(count).not.toHaveBeenCalled();
    }
  });

  it('narrows the list to the statuses asked for', async () => {
    const { store, service } = setup();
    const scheduled = store.addEvent({ status: SportEventStatus.SCHEDULED });
    const live = store.addEvent({ status: SportEventStatus.IN_PROGRESS });
    store.addEvent({ status: SportEventStatus.COMPLETED });

    const listed = await service.listEvents(
      { eventYear: 2026, statuses: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      { adminCounts: false },
    );

    expect(listed.map(({ event }) => event.id).sort()).toEqual([scheduled.id, live.id].sort());
  });

  it('reads one event with no counts at all, and 404s a draft for a released-only read or an unknown id', async () => {
    const { store, service, sportEvents } = setup();
    const draft = store.addEvent({ status: SportEventStatus.DRAFT });
    const countParticipants = jest.spyOn(sportEvents, 'countParticipants');
    const countTiers = jest.spyOn(sportEvents, 'countTiers');

    await expect(service.requireEvent(draft.id)).resolves.toMatchObject({ id: draft.id });
    await expect(service.requireEvent(draft.id, { releasedOnly: true })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    await expect(service.requireEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    expect(countParticipants).not.toHaveBeenCalled();
    expect(countTiers).not.toHaveBeenCalled();
  });

  it('lists a sport league\'s event years, leaving out a year with only drafts for a released-only read', async () => {
    const { store, service, sportLeague } = setup();
    store.addEvent({ sportLeagueId: sportLeague.id, eventYear: 2026 });
    store.addEvent({ sportLeagueId: sportLeague.id, eventYear: 2025 });
    store.addEvent({ sportLeagueId: sportLeague.id, eventYear: 2027, status: SportEventStatus.DRAFT });

    await expect(service.listEventYears(sportLeague.id, { releasedOnly: false })).resolves.toEqual([2025, 2026, 2027]);
    await expect(service.listEventYears(sportLeague.id, { releasedOnly: true })).resolves.toEqual([2025, 2026]);
  });

  it('refuses to list every event: a sport, a sport league or a year is required', async () => {
    const { store, service } = setup();
    store.addEvent();

    await expect(service.listEvents({}, { adminCounts: true })).rejects.toMatchObject({ code: 'SPORT_EVENT_FILTER_REQUIRED', statusCode: 400 });
    await expect(service.listEvents({ statuses: [SportEventStatus.DRAFT] }, { adminCounts: true })).rejects.toMatchObject({ code: 'SPORT_EVENT_FILTER_REQUIRED', statusCode: 400 });
  });

  it('updates an admin-managed event, clearing a field set to null', async () => {
    const { store, service } = setup();
    const event = store.addEvent({ venue: 'Old Course' });

    const updated = await service.updateEvent(event.id, { name: 'Renamed', venue: null }, TELL);

    expect(updated.event).toMatchObject({ name: 'Renamed', venue: undefined });
  });

  it('edits an event linked to a provider for scores, since every event is admin-owned, and 404s an unknown one', async () => {
    const { store, service } = setup();
    const linked = store.addEvent({ syncScope: 'SCORES_ONLY' });

    await expect(service.updateEvent(linked.id, { name: 'Renamed Open' }, TELL)).resolves.toMatchObject({ event: { name: 'Renamed Open' } });
    await expect(service.updateEvent('missing', { name: 'x' }, TELL)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
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

    await service.updateEvent(event.id, { rounds: 4 }, TELL);

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

    await service.updateEvent(event.id, { startDate: new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY) }, TELL);

    expect(roundsOf(store, event.id)).toEqual([
      { roundNumber: 1, scheduledDate: '2026-06-11T12:00:00.000Z' },
      { roundNumber: 2, scheduledDate: '2026-06-13T12:00:00.000Z' },
    ]);
  });

  it('tells the leagues on a released event its previous start when an admin moves it, but not for a draft or an unchanged start', async () => {
    const notice = { sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async () => undefined) };
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const { event: draft } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });
    const { event: released } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, name: 'Released Open' });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });
    const moved = new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY);

    await service.updateEvent(draft.id, { startDate: moved }, TELL);
    await service.updateEvent(released.id, { startDate: MANUAL_INPUT.startDate, name: 'Renamed Open' }, TELL);
    await service.updateEvent(released.id, { startDate: moved }, TELL);

    expect(notice.sportEventChanged).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: released.id, startDate: moved }),
      { kind: 'RESCHEDULED', previousStart: MANUAL_INPUT.startDate },
    );
  });

  it('moves a released event\'s start and its rounds without telling its leagues when the edit is a data correction', async () => {
    const notice = { sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async () => undefined) };
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const { event: released } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });
    // Noon UTC, the date-only placeholder, filled in with the real first tee time that day.
    const realStart = new Date('2026-06-04T11:45:00.000Z');

    await service.updateEvent(released.id, { startDate: realStart }, { tellMembers: false });

    expect(notice.sportEventChanged).not.toHaveBeenCalled();
    expect(roundsOf(store, released.id)).toEqual([{ roundNumber: 1, scheduledDate: '2026-06-04T11:45:00.000Z' }]);
  });

  it('refuses a quiet move of a released event that already has a real start time, so its leagues are never left out of a real reschedule', async () => {
    const notice = { sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async () => undefined) };
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const realStart = new Date('2026-06-04T11:45:00.000Z');
    const { event: released } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, startDate: realStart, rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });

    await expect(service.updateEvent(released.id, { startDate: new Date(realStart.getTime() + DAY) }, { tellMembers: false }))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_START_NOT_PLACEHOLDER', statusCode: 400 });

    expect(notice.sportEventChanged).not.toHaveBeenCalled();
    expect(roundsOf(store, released.id)).toEqual([{ roundNumber: 1, scheduledDate: '2026-06-04T11:45:00.000Z' }]);
  });

  it('leaves the round schedule alone when an edit changes neither the start date nor the round count', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT, rounds: 2 });
    const before = roundsOf(store, event.id);

    await service.updateEvent(event.id, { name: 'Renamed', startDate: MANUAL_INPUT.startDate, rounds: 2 }, TELL);

    expect(roundsOf(store, event.id)).toEqual(before);
  });
});

describe('PATCH /events/:eventId handler passes tellMembers on to the event service', () => {
  type UpdateEventRequest = Parameters<ReturnType<typeof createEventHandlers>['updateEvent']>[0];

  function setupHandlers() {
    const notice = { sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async () => undefined) };
    const { store, service, sportLeague, lifecycle } = setup(Sport.GOLF, notice);
    const handlers = createEventHandlers({
      services: {
        sportEvents: service,
        rounds: stubInstance(SportEventRoundService, {}),
        bracket: stubInstance(SportEventBracketService, {}),
        tiers: stubInstance(SportEventTierService, {}),
        field: stubInstance(SportEventParticipantService, {}),
        golfScores: stubInstance(GolfScoreService, {}),
        raceResults: stubInstance(RaceResultService, {}),
        statLines: stubInstance(StatLineService, {}),
        matchResults: stubInstance(MatchResultService, {}),
        sportLeagues: stubInstance(SportLeagueService, {}),
      },
      eventLifecycle: lifecycle,
      scoreSource: stubInstance(EventScoreSourceService, {}),
      ingestion: stubInstance(IngestionService, {}),
    });
    return { store, service, sportLeague, notice, handlers };
  }

  async function releasedPlaceholderEvent({ store, service, sportLeague }: ReturnType<typeof setupHandlers>) {
    const { event } = await service.createEvent({ sportLeagueId: sportLeague.id, eventYear: 2026, ...MANUAL_INPUT });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
    return event;
  }

  it('fills in a released event\'s real start time without telling its leagues when the body says tellMembers false', async () => {
    const context = setupHandlers();
    const event = await releasedPlaceholderEvent(context);

    const response = await context.handlers.updateEvent(asFastifyRequest<UpdateEventRequest>({
      params: { eventId: event.id },
      body: { startDate: '2026-06-04T11:45:00.000Z', tellMembers: false },
    }));

    expect(response.event.startDate).toBe('2026-06-04T11:45:00.000Z');
    expect(context.notice.sportEventChanged).not.toHaveBeenCalled();
  });

  it('tells a released event\'s leagues about a moved start when the body leaves tellMembers out', async () => {
    const context = setupHandlers();
    const event = await releasedPlaceholderEvent(context);

    await context.handlers.updateEvent(asFastifyRequest<UpdateEventRequest>({
      params: { eventId: event.id },
      body: { startDate: '2026-06-04T11:45:00.000Z' },
    }));

    expect(context.notice.sportEventChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: event.id, startDate: new Date('2026-06-04T11:45:00.000Z') }),
      { kind: 'RESCHEDULED', previousStart: MANUAL_INPUT.startDate },
    );
  });
});

describe('event read handlers count admin numbers for a root admin only (#1198)', () => {
  type ListEventsRequest = Parameters<ReturnType<typeof createEventHandlers>['listEvents']>[0];
  type GetEventRequest = Parameters<ReturnType<typeof createEventHandlers>['getEvent']>[0];
  type ListEventYearsRequest = Parameters<ReturnType<typeof createEventHandlers>['listEventYears']>[0];

  const MEMBER = { userId: 'member-1', email: 'member-1@unit.test', isRootAdmin: false, sessionId: null };
  const ROOT_ADMIN = { userId: 'admin-1', email: 'admin-1@unit.test', isRootAdmin: true, sessionId: null };
  const log = fakeLogger();

  function setupHandlers() {
    const context = setup();
    const listBracket = mockFn<SportEventBracketService['listBracket']>(async () => []);
    const handlers = createEventHandlers({
      services: {
        sportEvents: context.service,
        rounds: stubInstance(SportEventRoundService, {}),
        bracket: stubInstance(SportEventBracketService, { listBracket }),
        tiers: stubInstance(SportEventTierService, {}),
        field: stubInstance(SportEventParticipantService, {}),
        golfScores: stubInstance(GolfScoreService, {}),
        raceResults: stubInstance(RaceResultService, {}),
        statLines: stubInstance(StatLineService, {}),
        matchResults: stubInstance(MatchResultService, {}),
        sportLeagues: stubInstance(SportLeagueService, {}),
      },
      eventLifecycle: context.lifecycle,
      scoreSource: stubInstance(EventScoreSourceService, {}),
      ingestion: stubInstance(IngestionService, {}),
    });
    const countContests = jest.spyOn(context.sportEvents, 'countContests');
    return { ...context, handlers, listBracket, countContests };
  }

  it('gives a member\'s event list null admin counts, without counting contests across leagues', async () => {
    const { store, handlers, countContests } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.contestsByEvent.set(event.id, 3);

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({ query: { eventYear: 2026 }, authUser: MEMBER, log }));

    expect(response.events).toEqual([expect.objectContaining({ id: event.id, adminCounts: null })]);
    expect(countContests).not.toHaveBeenCalled();
  });

  it('gives a root admin\'s event list each event\'s admin counts, drafts included', async () => {
    const { store, handlers } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.DRAFT });
    store.contestsByEvent.set(event.id, 3);

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({ query: { eventYear: 2026 }, authUser: ROOT_ADMIN, log }));

    expect(response.events).toEqual([expect.objectContaining({ id: event.id, adminCounts: expect.objectContaining({ contestCount: 3 }) })]);
  });

  it('passes the statuses asked for on to the list, so contest setup reads only events it can offer', async () => {
    const { store, handlers } = setupHandlers();
    const scheduled = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.addEvent({ status: SportEventStatus.COMPLETED });

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({
      query: { eventYear: 2026, status: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      authUser: MEMBER,
      log,
    }));

    expect(response.events.map((event) => event.id)).toEqual([scheduled.id]);
  });

  it('gives a member one event with null admin counts, and a root admin the same event with them', async () => {
    const { store, handlers } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.contestsByEvent.set(event.id, 2);

    const member = await handlers.getEvent(asFastifyRequest<GetEventRequest>({ params: { eventId: event.id }, authUser: MEMBER }));
    const admin = await handlers.getEvent(asFastifyRequest<GetEventRequest>({ params: { eventId: event.id }, authUser: ROOT_ADMIN }));

    expect(member.event.adminCounts).toBeNull();
    expect(admin.event.adminCounts).toMatchObject({ contestCount: 2 });
  });

  it('answers a member\'s bracket read on a draft with 404 from one event read, counting nothing', async () => {
    const { store, handlers, sportEvents, listBracket } = setupHandlers();
    const draft = store.addEvent({ status: SportEventStatus.DRAFT });
    const countParticipants = jest.spyOn(sportEvents, 'countParticipants');

    await expect(handlers.getEventBracket(asFastifyRequest<GetEventRequest>({ params: { eventId: draft.id }, authUser: MEMBER })))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    await expect(handlers.getEventBracket(asFastifyRequest<GetEventRequest>({ params: { eventId: draft.id }, authUser: ROOT_ADMIN })))
      .resolves.toEqual({ matches: [] });
    expect(listBracket).toHaveBeenCalledTimes(1);
    expect(countParticipants).not.toHaveBeenCalled();
  });

  it('lists a sport league\'s event years, a draft-only year for a root admin alone', async () => {
    const { store, handlers, sportLeague } = setupHandlers();
    store.addEvent({ sportLeagueId: sportLeague.id, eventYear: 2026 });
    store.addEvent({ sportLeagueId: sportLeague.id, eventYear: 2027, status: SportEventStatus.DRAFT });

    const member = await handlers.listEventYears(asFastifyRequest<ListEventYearsRequest>({ query: { sportLeagueId: sportLeague.id }, authUser: MEMBER }));
    const admin = await handlers.listEventYears(asFastifyRequest<ListEventYearsRequest>({ query: { sportLeagueId: sportLeague.id }, authUser: ROOT_ADMIN }));

    expect(member).toEqual({ years: [2026] });
    expect(admin).toEqual({ years: [2026, 2027] });
  });
});
