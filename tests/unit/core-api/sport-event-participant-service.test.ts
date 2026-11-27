import { legacyMatch } from '../../support/match-sides';
import { testDomainEvents } from '../../support/domain-events';
import { expect, jest } from '@jest/globals';
import { SlotKind, Sport, SportEventStatus, type SportLeagueSeasonSlot, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import { SportEventParticipantService } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { expectDefined } from '../../support/expect-defined';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { standardEventPricing } from '../../support/budget-pricing';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import type { SportEventParticipantView } from '@poolmaster/shared/db';
import { roundSlot } from '../../support/round-slots';

// The field's rules against an in-memory store: the one read every field screen uses,
// seeding from the sport league, adding anyone, the all-or-none grid save, and removal.

function setup(sportName: Sport = Sport.GOLF, status: SportEventStatus = SportEventStatus.DRAFT) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  // A draft, so its prices are still editable (#431); pass a released status to lock them.
  const event = store.addEvent({ sportLeagueId: sportLeague.id, sport: sportName, status });
  const domainEvents = new RecordingDomainEvents();
  const service = new SportEventParticipantService({
    sportEvents: store.sportEventRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    matches: store.matchRepo(), tiers: store.tierRepo(), valuations: store.valuationRepo(),
    domainEvents,
  });
  return { store, service, sport, sportLeague, event, domainEvents };
}

describe('SportEventParticipantService.listEventParticipants', () => {
  it('returns each field row with its participant, valuation, standing and its side result in each FIELD Game', async () => {
    const { store, service, sport, event } = setup();
    const golfer = store.addParticipant(sport.id, 'Ana');
    const entry = store.addToField(event.id, golfer.id, { seedNumber: 1 });
    const [round] = await (async () => { await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: new Date() }]); return store.roundRows; })();
    await store.fieldGameRepo().applyResults(event.id, {
      games: [{ roundNumber: round.roundNumber, status: 'COMPLETED', completedAt: null, sides: [{ sportEventParticipantId: entry.id, score: 70, scoreToPar: -2, periodsCompleted: 18, position: null, startPosition: null, status: 'FINISHED' }] }],
      standings: [{ sportEventParticipantId: entry.id, position: 1, displayPosition: '1', status: 'COMPLETE', asOf: new Date(), total: 70, scoreToPar: -2 }],
    });
    await store.valuationRepo().assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: entry.id, price: 9, source: 'MANUAL' }],
    });

    const [view] = await service.listEventParticipants(event.id);

    expect(view.participant.name).toBe('Ana');
    expect(view.valuation).toMatchObject({ price: 9 });
    expect(view.standing).toMatchObject({ scoreToPar: -2, total: 70 });
    expect(view.fieldResults).toEqual([expect.objectContaining({ roundNumber: 1, result: expect.objectContaining({ score: 70, scoreToPar: -2, periodsCompleted: 18 }) })]);
  });

  it('flags a participant of the event\'s sport league, and one invited from another league', async () => {
    const { store, service, sport, sportLeague, event } = setup();
    const member = store.addParticipant(sport.id, 'Member', { sportLeagueId: sportLeague.id });
    const guest = store.addParticipant(sport.id, 'Guest', { sportLeagueId: store.addSportLeague(sport.id, 'LIV Golf').id });
    store.addToField(event.id, member.id, { seedNumber: 1 });
    store.addToField(event.id, guest.id, { seedNumber: 2 });

    const views = await service.listEventParticipants(event.id);

    expect(views.map((view) => [view.participant.name, view.affiliatedWithSportLeague])).toEqual([['Member', true], ['Guest', false]]);
  });

  it('flags nobody as affiliated on an event of another sport league\'s series, and fails with 404 for an unknown event', async () => {
    const { store, service, sport } = setup();
    const orphan = store.addEvent();
    store.addToField(orphan.id, store.addParticipant(sport.id, 'Solo').id);

    await expect(service.listEventParticipants(orphan.id)).resolves.toEqual([expect.objectContaining({ affiliatedWithSportLeague: false })]);
    await expect(service.listEventParticipants('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

// #1163 — what viewers poll is shared by every service in the container for 30 seconds; what
// a write answers with is read now.
describe('SportEventParticipantService — the field viewers share', () => {
  const T0 = new Date('2026-10-28T20:00:00.000Z');

  function sharing() {
    const context = setup();
    const fieldCache = new ReadCache<SportEventParticipantView[]>();
    let now = T0;
    const serviceSharing = () => new SportEventParticipantService({ domainEvents: testDomainEvents(),
      sportEvents: context.store.sportEventRepo(),
      field: context.store.fieldRepo(),
      participants: context.store.participantRepo(),
      matches: context.store.matchRepo(), tiers: context.store.tierRepo(), valuations: context.store.valuationRepo(),
      fieldCache,
      now: () => now,
    });
    return { ...context, fieldCache, serviceSharing, advance: (ms: number) => { now = new Date(T0.getTime() + ms); } };
  }

  it('answers every service in the container with the field one of them read in the last 30 seconds, and reads it again after', async () => {
    const { store, sport, event, serviceSharing, advance } = sharing();
    const golfer = store.addToField(event.id, store.addParticipant(sport.id, 'Ana').id, { ranking: 5 });
    const contestReads = serviceSharing();
    const pickScreenReads = serviceSharing();

    await contestReads.listCachedEventParticipants(event.id);
    golfer.ranking = 1;
    advance(29_999);
    const shared = await pickScreenReads.listCachedEventParticipants(event.id);
    advance(30_000);
    const reread = await pickScreenReads.listCachedEventParticipants(event.id);

    expect(shared.map((row) => row.entry.ranking)).toEqual([5]);
    expect(reread.map((row) => row.entry.ranking)).toEqual([1]);
  });

  it('reads the field afresh within the 30 seconds once a write has forgotten it, and listEventParticipants always reads it now', async () => {
    const { store, sport, event, fieldCache, serviceSharing } = sharing();
    const golfer = store.addToField(event.id, store.addParticipant(sport.id, 'Ana').id, { ranking: 5 });
    const service = serviceSharing();

    await service.listCachedEventParticipants(event.id);
    golfer.ranking = 1;
    const now = await service.listEventParticipants(event.id);
    const stillShared = await service.listCachedEventParticipants(event.id);
    fieldCache.forget(event.id);
    const afterTheWrite = await service.listCachedEventParticipants(event.id);

    expect(now.map((row) => row.entry.ranking)).toEqual([1]);
    expect(stillShared.map((row) => row.entry.ranking)).toEqual([5]);
    expect(afterTheWrite.map((row) => row.entry.ranking)).toEqual([1]);
  });

  it('does not keep a 404 for an unknown event, so an event created since is read', async () => {
    const { serviceSharing } = sharing();

    await expect(serviceSharing().listCachedEventParticipants('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventParticipantService.getEventParticipant', () => {
  it('reads one field row as the field read gives it, and 404s for a row on another event or an unknown event', async () => {
    const { store, service, sport, sportLeague, event } = setup();
    const ana = store.addParticipant(sport.id, 'Ana');
    store.affiliate(sportLeague.id, ana.id);
    store.addToField(event.id, store.addParticipant(sport.id, 'Bea').id, { seedNumber: 1 });
    const row = store.addToField(event.id, ana.id, { seedNumber: 2 });
    const elsewhere = store.addToField(store.addEvent({ sportLeagueId: sportLeague.id }).id, ana.id);

    const one = await service.getEventParticipant(event.id, row.id);

    expect(one).toEqual((await service.listEventParticipants(event.id))[1]);
    expect(one).toMatchObject({ participant: { name: 'Ana' }, affiliatedWithSportLeague: true });
    await expect(service.getEventParticipant(event.id, elsewhere.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
    await expect(service.getEventParticipant('missing', row.id)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventParticipantService — changing the field', () => {
  it('adds anyone to the field, skipping ones already on it', async () => {
    const { store, service, sport, event } = setup();
    const already = store.addParticipant(sport.id, 'A');
    const guest = store.addParticipant(sport.id, 'G');
    store.addToField(event.id, already.id);

    await expect(service.addParticipants(event.id, [already.id, guest.id])).resolves.toEqual({ added: 1, skipped: 1, total: 2 });
    expect(store.field.map((entry) => entry.participantId)).toEqual([already.id, guest.id]);
  });

  it('adds a test participant to an event on a test slot (#2096)', async () => {
    const { store, service, sport, event } = setup();
    store.slotsByEvent.set(event.id, [{ id: 'slot-test', isTestData: true } as SportLeagueSeasonSlot]);
    const tester = store.addParticipant(sport.id, 'Test golfer', { isTestData: true });

    await expect(service.addParticipants(event.id, [tester.id])).resolves.toEqual({ added: 1, skipped: 0, total: 1 });
  });

  it('refuses a test participant on an event the sync keeps with 422 TEST_PARTICIPANT_NOT_ON_TEST_SLOT, adding no one (#2096)', async () => {
    const { store, service, sport, event } = setup();
    const real = store.addParticipant(sport.id, 'Real golfer');
    const tester = store.addParticipant(sport.id, 'Test golfer', { isTestData: true });

    await expect(service.addParticipants(event.id, [real.id, tester.id])).rejects.toMatchObject({ code: 'TEST_PARTICIPANT_NOT_ON_TEST_SLOT', statusCode: 422 });
    expect(store.field).toEqual([]);
  });

  it('saves the grid all or none: a row off this event\'s field is refused with 404 before anything is written', async () => {
    const { store, service, sport, event } = setup();
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });
    const other = store.addToField(store.addEvent().id, store.addParticipant(sport.id, 'B').id);

    await expect(service.updateParticipants(event.id, [
      { sportEventParticipantId: entry.id, ranking: 1 },
      { sportEventParticipantId: other.id, ranking: 2 },
    ])).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
    expect(entry.ranking).toBe(4);

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, ranking: null, price: 11 }]);

    expect(view.entry.ranking).toBeUndefined();
    expect(view.valuation).toMatchObject({ price: 11, priceAssignedSource: 'MANUAL' });
  });

  it('writes only the values a grid save changes, leaving out values sent as they already are (#1252)', async () => {
    const store = new InMemorySportEvents();
    const sport = store.addSport(Sport.GOLF);
    const event = store.addEvent({ sportLeagueId: store.addSportLeague(sport.id).id, sport: Sport.GOLF, status: SportEventStatus.DRAFT });
    const field = store.fieldRepo();
    const updateMany = jest.spyOn(field, 'updateMany');
    const service = new SportEventParticipantService({ domainEvents: testDomainEvents(),
      sportEvents: store.sportEventRepo(), field, participants: store.participantRepo(),
      matches: store.matchRepo(), tiers: store.tierRepo(), valuations: store.valuationRepo(),
    });
    const same = store.addToField(event.id, store.addParticipant(sport.id, 'Same').id, { ranking: 4, oddsToWin: 20 });
    const moved = store.addToField(event.id, store.addParticipant(sport.id, 'Moved').id, { ranking: 5, oddsToWin: 30 });

    await service.updateParticipants(event.id, [
      { sportEventParticipantId: same.id, ranking: 4, oddsToWin: 20, status: SportEventParticipantStatus.ACTIVE },
      { sportEventParticipantId: moved.id, ranking: 2, oddsToWin: 30, seedNumber: null },
    ]);

    expect(updateMany).toHaveBeenCalledWith([
      { id: same.id, updates: {}, price: undefined },
      { id: moved.id, updates: { ranking: 2 }, price: undefined },
    ], [eventRebuildJob(event.id)]);
    expect([same.ranking, moved.ranking]).toEqual([4, 2]);
  });

  it('refuses a price in the grid save once the event is released (409 SPORT_EVENT_TIERS_LOCKED), writing nothing', async () => {
    const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.SCHEDULED);
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, ranking: 1, price: 11 }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_TIERS_LOCKED', statusCode: 409 });
    expect(entry.ranking).toBe(4);
    expect(store.valuationRows).toEqual([]);
  });

  describe('a tier move in the same save', () => {
    async function tiered() {
      const context = setup();
      const { store, sport, event } = context;
      await store.addTiers(event.id, [{ tierKey: 'tier-1', tierNumber: 1 }, { tierKey: 'tier-2', tierNumber: 2 }]);
      const [tier1, tier2] = await store.tierRepo().findBySportEvent(event.id);
      const add = (name: string) => store.addToField(event.id, store.addParticipant(sport.id, name).id);
      return { ...context, tier1, tier2, add };
    }

    it('places the moved participant after the highest place in its new tier, so a tier with gaps never repeats a place, and marks the tier and price manual', async () => {
      const { store, service, event, tier1, tier2, add } = await tiered();
      const [first, third, moving] = [add('First'), add('Third'), add('Moving')];
      await store.valuationRepo().assignTiers([
        { sportEventParticipantId: first.id, sportEventTierId: tier2.id, tierOrderIndex: 0, source: 'AUTO_ODDS' },
        { sportEventParticipantId: third.id, sportEventTierId: tier2.id, tierOrderIndex: 2, source: 'AUTO_ODDS' },
        { sportEventParticipantId: moving.id, sportEventTierId: tier1.id, tierOrderIndex: 0, source: 'AUTO_ODDS' },
      ]);

      await service.updateParticipants(event.id, [{ sportEventParticipantId: moving.id, tierKey: 'tier-2', price: 900 }]);

      expect(store.valuationRows.find((row) => row.sportEventParticipantId === moving.id)).toMatchObject({
        sportEventTierId: tier2.id, tierOrderIndex: 3, tierAssignedSource: 'MANUAL', price: 900, priceAssignedSource: 'MANUAL',
      });
    });

    it('gives two participants moved into one tier in one save consecutive places, starting at 0 in an empty tier', async () => {
      const { store, service, event, tier1, add } = await tiered();
      const [a, b] = [add('A'), add('B')];

      await service.updateParticipants(event.id, [
        { sportEventParticipantId: a.id, tierKey: 'tier-1' },
        { sportEventParticipantId: b.id, tierKey: 'tier-1' },
      ]);

      expect(store.valuationRows.map((row) => [row.sportEventParticipantId, row.sportEventTierId, row.tierOrderIndex])).toEqual([
        [a.id, tier1.id, 0],
        [b.id, tier1.id, 1],
      ]);
    });

    it('refuses a tier the event does not have (422 UNKNOWN_TIER_KEY) and writes none of the save', async () => {
      const { store, service, event, add } = await tiered();
      const entry = add('A');

      await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, ranking: 3, tierKey: 'tier-9' }]))
        .rejects.toMatchObject({ code: 'UNKNOWN_TIER_KEY', statusCode: 422 });
      expect(entry.ranking).not.toBe(3);
      expect(store.valuationRows).toEqual([]);
    });

    it('refuses a tier move once the event is released (409 SPORT_EVENT_TIERS_LOCKED)', async () => {
      const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.SCHEDULED);
      await store.addTiers(event.id, [{ tierKey: 'tier-1', tierNumber: 1 }]);
      const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id);

      await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, tierKey: 'tier-1' }]))
        .rejects.toMatchObject({ code: 'SPORT_EVENT_TIERS_LOCKED', statusCode: 409 });
      expect(store.valuationRows).toEqual([]);
    });
  });

  it('still saves rank, odds, seed and withdrawals in the grid after the event is released', async () => {
    const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.SCHEDULED);
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });

    const [view] = await service.updateParticipants(event.id, [
      { sportEventParticipantId: entry.id, ranking: 1, oddsToWin: 12.5, seedNumber: 3, status: SportEventParticipantStatus.WITHDRAWN },
    ]);

    expect(view.entry).toMatchObject({ ranking: 1, oddsToWin: 12.5, seedNumber: 3, status: SportEventParticipantStatus.WITHDRAWN });
  });

  it('removes a field row, refusing one a contest entry has picked (409) or one on another event (404)', async () => {
    const { store, service, sport, event } = setup();
    const free = store.addToField(event.id, store.addParticipant(sport.id, 'Free').id);
    const picked = store.addToField(event.id, store.addParticipant(sport.id, 'Picked').id);
    store.picksByEntry.set(picked.id, 2);

    await service.removeParticipant(event.id, free.id);

    expect(store.field.map((entry) => entry.id)).toEqual([picked.id]);
    await expect(service.removeParticipant(event.id, picked.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_HAS_PICKS', statusCode: 409 });
    await expect(service.removeParticipant('other-event', picked.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to remove a team a bracket match names (409 EVENT_PARTICIPANT_IN_BRACKET), keeping the row', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id);
    store.matchRows.push(legacyMatch({
      id: 'match-1', sportEventId: event.id, roundNumber: 1, slot: roundSlot(SlotKind.FINAL), matchNumber: 1,
      homeSportEventParticipantId: null, awaySportEventParticipantId: duke.id, isNeutralSite: true,
    }));

    await expect(service.removeParticipant(event.id, duke.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_IN_BRACKET', statusCode: 409 });
    expect(store.field.map((entry) => entry.id)).toEqual([duke.id]);
  });
});

// A bracket's upset bonus reads seeds as they stood at release, so release locks them there (#698).
describe('SportEventParticipantService — seeds on a released bracket', () => {
  it('refuses a seed change on a released basketball event (409 SPORT_EVENT_SEEDS_LOCKED), writing nothing', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.SCHEDULED);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1, ranking: 1 });

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 2, ranking: 3 }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_SEEDS_LOCKED', statusCode: 409 });
    expect(duke).toMatchObject({ seedNumber: 1, ranking: 1 });
  });

  it('still saves a released bracket\'s other values, and a seed sent unchanged', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.SCHEDULED);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1, ranking: 1 });

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 1, ranking: 2, status: SportEventParticipantStatus.WITHDRAWN }]);

    expect(view.entry).toMatchObject({ seedNumber: 1, ranking: 2, status: SportEventParticipantStatus.WITHDRAWN });
  });

  it('changes a bracket\'s seeds freely while the event is a draft', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.DRAFT);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1 });

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 2 }]);

    expect(view.entry.seedNumber).toBe(2);
  });
});

// The field upload adjusts golfers already on the field; it resolves rows against the field
// alone and never adds a field row or a participant.
describe('SportEventParticipantService — the field comes from the feed (#2008)', () => {
  it('offers no field upload: a field row changes only through the grid save, named by its id', () => {
    const methods = Object.getOwnPropertyNames(SportEventParticipantService.prototype);

    expect(methods.filter((name) => /upload/i.test(name))).toEqual([]);
    expect(methods).toContain('updateParticipants');
  });
});

describe('SportEventParticipantService — leaderboard rebuild (#1466)', () => {
  it('writes the event\'s rebuild job with each field write (add, grid save, removal) and wakes the runner after each', async () => {
    const { store, service, sport, event, domainEvents } = setup();
    const guest = store.addParticipant(sport.id, 'Guest', { sportLeagueId: store.addSportLeague(sport.id, 'LIV Golf').id });

    await service.addParticipants(event.id, [guest.id]);
    const added = expectDefined(store.field.find((entry) => entry.participantId === guest.id));
    await service.updateParticipants(event.id, [{ sportEventParticipantId: added.id, ranking: 3 }]);
    await service.removeParticipant(event.id, added.id);

    expect(store.backgroundJobs).toEqual(Array.from({ length: 3 }, () => eventRebuildJob(event.id)));
    expect(domainEvents.changedSportEventIds).toEqual([event.id, event.id, event.id]);
  });

  it('writes no rebuild when an add finds everyone already on the field, and none for a refused removal', async () => {
    const { store, service, sport, event, domainEvents } = setup();
    const already = store.addParticipant(sport.id, 'Already');
    const picked = store.addToField(event.id, already.id);
    store.picksByEntry.set(picked.id, 1);

    await service.addParticipants(event.id, [already.id]);
    await expect(service.removeParticipant(event.id, picked.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_HAS_PICKS' });

    expect(store.backgroundJobs).toEqual([]);
    expect(domainEvents.handedOutSportEventIds).toEqual([]);
  });
});
