import { SportEventStatus, TierSource } from '@poolmaster/shared/domain';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// Tier and valuation rules against an in-memory store: defaults, the fill order of
// auto-assignment, the orphan guard on replacement, the drag-and-drop save's checks,
// and pricing. The replacement's transactional mechanics are the adapter's, tested in
// sport-event-repositories.integration.

const TWO_TIERS = [
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2, defaultPickCount: 1 },
];

function setup(status: SportEventStatus = SportEventStatus.DRAFT) {
  const store = new InMemorySportEvents();
  // Tiers and prices are set while the event is a draft; release locks them (#431).
  const event = store.addEvent({ status });
  const service = new SportEventTierService({
    sportEvents: store.sportEventRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    field: store.fieldRepo(),
    random: () => 0.5,
  });
  return { store, event, service };
}

describe('SportEventTierService — tiers', () => {
  it('creates six default tiers once, and leaves an event that has tiers alone', async () => {
    const { store, event, service } = setup();

    await service.ensureDefaultTiers(event.id);
    const again = await service.ensureDefaultTiers(event.id);

    expect(again.map((tier) => tier.tierKey)).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-6']);
    expect(store.tierRows).toHaveLength(6);
  });

  it('refuses a replacement that would strand placed participants unless they are sent somewhere', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');
    const [, tier2] = store.tierRows;
    await store.valuationRepo().assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await expect(service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]] }))
      .rejects.toMatchObject({ code: 'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS', statusCode: 409 });
    await expect(service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]], reassignOrphansTo: 'tier-9' }))
      .rejects.toMatchObject({ code: 'REASSIGN_TARGET_TIER_NOT_FOUND', statusCode: 422 });

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]], reassignOrphansTo: 'tier-1' });

    expect(groups).toEqual([expect.objectContaining({ tierKey: 'tier-1', participants: [expect.objectContaining({ participantId: 'p-1', tierOrderIndex: null })] })]);
  });
});

describe('SportEventTierService — assignment', () => {
  it('fills tiers in order by odds, tierSize each, the last tier taking the rest, and skips inactive participants', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    store.addToField(event.id, 'p-long', { oddsToWin: 50 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 5 });
    store.addToField(event.id, 'p-mid', { oddsToWin: 20 });
    store.addToField(event.id, 'p-out', { oddsToWin: 1, isActive: false });

    const groups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS, tierSize: 1 });

    expect(groups.map((group) => group.participants.map((placement) => placement.participantId))).toEqual([
      ['p-fav'],
      ['p-mid', 'p-long'],
    ]);
    expect(store.valuationRows.every((valuation) => valuation.tierAssignedSource === 'AUTO_ODDS')).toBe(true);
  });

  it('orders by ranking first when asked to, falling back to odds on a tie, and records the source', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, [TWO_TIERS[0]]);
    store.addToField(event.id, 'p-b', { ranking: 3, oddsToWin: 30 });
    store.addToField(event.id, 'p-a', { ranking: 3, oddsToWin: 10 });
    store.addToField(event.id, 'p-c', { ranking: 1, oddsToWin: 90 });

    const [group] = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.RANKING });

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-c', 'p-a', 'p-b']);
    expect(store.valuationRows[0].tierAssignedSource).toBe('AUTO_RANKING');
  });

  it('does nothing for an event with no tiers yet', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1');

    await expect(service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS })).resolves.toEqual([]);
    expect(store.valuationRows).toEqual([]);
  });

  it('checks the whole drag-and-drop save before writing: an unknown tier key is 422, a row off the field is 404', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');

    await expect(service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: entry.id, tierKey: 'nope', tierOrderIndex: 1 }] }))
      .rejects.toMatchObject({ code: 'UNKNOWN_TIER_KEY', statusCode: 422 });
    await expect(service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: 'elsewhere', tierKey: 'tier-1', tierOrderIndex: 1 }] }))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
    expect(store.valuationRows).toEqual([]);

    await service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: entry.id, tierKey: 'tier-2', tierOrderIndex: 7 }] });

    expect(store.valuationRows).toEqual([expect.objectContaining({ tierOrderIndex: 7, tierAssignedSource: 'MANUAL' })]);
  });
});

describe('SportEventTierService — prices and the contest-side read', () => {
  it('prices only the seeded, active field, best seed dearest, leaving tiers alone', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1', { seedNumber: 1 });
    store.addToField(event.id, 'p-2', { seedNumber: 2 });
    store.addToField(event.id, 'p-unseeded');

    const views = await service.autoAssignPrices({ sportEventId: event.id, minPrice: 5, maxPrice: 50 });

    expect(views).toHaveLength(2);
    const [first, second] = views;
    expect(first.price).toBeGreaterThan(second.price as number);
    expect(views.every((view) => view.tierId === null)).toBe(true);
  });

  it('reads a price-only valuation with no tier, which a read starting from the tiers would miss', async () => {
    const { store, event, service } = setup();
    const entry = store.addToField(event.id, 'p-budget');
    await store.valuationRepo().assignPrices([{ sportEventParticipantId: entry.id, price: 12, source: 'MANUAL' }]);

    await expect(service.getEffectiveValuationsForSportEvent(event.id)).resolves.toEqual([
      expect.objectContaining({ participantId: 'p-budget', price: 12, tierId: null, tierKey: null }),
    ]);
    await expect(service.getEffectiveTiersForSportEvent(event.id)).resolves.toEqual([]);
  });
});

describe('SportEventTierService — locked once the event is released (#431)', () => {
  it.each([
    SportEventStatus.SCHEDULED,
    SportEventStatus.IN_PROGRESS,
    SportEventStatus.COMPLETED,
  ])('refuses every tier and price write on a %s event with 409 SPORT_EVENT_TIERS_LOCKED, changing nothing', async (status) => {
    const { store, event, service } = setup(status);
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'participant-a', { ranking: 1, seedNumber: 1 });
    const locked = { code: 'SPORT_EVENT_TIERS_LOCKED', statusCode: 409 };

    await expect(service.replaceTiers({ sportEventId: event.id, tiers: TWO_TIERS.slice(0, 1) })).rejects.toMatchObject(locked);
    await expect(service.replaceTierAssignments({
      sportEventId: event.id,
      assignments: [{ sportEventParticipantId: entry.id, tierKey: 'tier-1', tierOrderIndex: 1 }],
    })).rejects.toMatchObject(locked);
    await expect(service.autoAssignTiers({ sportEventId: event.id, source: TierSource.RANKING })).rejects.toMatchObject(locked);
    await expect(service.autoAssignPrices({ sportEventId: event.id, minPrice: 5, maxPrice: 10 })).rejects.toMatchObject(locked);

    expect(store.tierRows).toHaveLength(2);
    expect(store.valuationRows).toEqual([]);
  });

  it('refuses a tier write on an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { service } = setup();

    await expect(service.autoAssignTiers({ sportEventId: 'missing', source: TierSource.RANKING }))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});
