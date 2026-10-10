import { SportEventStatus, TierSource } from '@poolmaster/shared/domain';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { standardEventPricing } from '../../support/budget-pricing';

// Tier and valuation rules against an in-memory store: defaults, the fill order of
// auto-assignment, the orphan guard on replacement, the drag-and-drop save's checks,
// and pricing. The replacement's transactional mechanics are the adapter's, tested in
// sport-event-repositories.integration.

const TWO_TIERS = [
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
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
  it('prices the whole active field on the curve, best seed dearest and an unseeded golfer cheapest, leaving tiers alone', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-unseeded');
    store.addToField(event.id, 'p-2', { seedNumber: 2 });
    store.addToField(event.id, 'p-1', { seedNumber: 1 });
    store.addToField(event.id, 'p-withdrawn', { seedNumber: 3, isActive: false });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() });

    const priceOf = new Map(views.map((view) => [view.participantId, view.price]));
    expect(Object.fromEntries(priceOf)).toEqual({ 'p-1': 12000, 'p-2': 6400, 'p-unseeded': 6000 });
    expect(views.every((view) => view.tierId === null)).toBe(true);
    expect(store.valuationRows.every((row) => row.priceAssignedSource === 'AUTO_RANKING')).toBe(true);
  });

  it('records on the event the values its field was priced with, replacing the last ones on a re-price', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1', { seedNumber: 1 });
    const small = { ...standardEventPricing(), profileName: 'Small', salaryCap: 5000, unit: 10 };

    await service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() });
    await service.autoAssignPrices({ sportEventId: event.id, pricingConfig: small });

    expect((await store.sportEventRepo().findById(event.id))?.pricingConfig).toEqual(small);
    expect(store.valuationRows.map((row) => row.price)).toEqual([1200]);
  });

  it.each([
    ['a floor share above the top share', { floorSharePercent: 30 }],
    ['a rounding unit above the salary cap', { unit: 60_000 }],
  ])('refuses %s with 422 PRICING_CONFIG_INVALID, pricing nothing', async (_case, change) => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1', { seedNumber: 1 });

    await expect(service.autoAssignPrices({ sportEventId: event.id, pricingConfig: { ...standardEventPricing(), ...change } }))
      .rejects.toMatchObject({ code: 'PRICING_CONFIG_INVALID', statusCode: 422 });
    expect(store.valuationRows).toEqual([]);
    expect((await store.sportEventRepo().findById(event.id))?.pricingConfig).toBeUndefined();
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
    await expect(service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() })).rejects.toMatchObject(locked);

    expect(store.tierRows).toHaveLength(2);
    expect(store.valuationRows).toEqual([]);
  });

  it('refuses a tier write on an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { service } = setup();

    await expect(service.autoAssignTiers({ sportEventId: 'missing', source: TierSource.RANKING }))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventTierService — the field changing between assignments', () => {
  it('places golfers with no ranking after every ranked golfer when tiering by ranking', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, [TWO_TIERS[0]]);
    store.addToField(event.id, 'p-unranked');
    store.addToField(event.id, 'p-second', { ranking: 2 });
    store.addToField(event.id, 'p-first', { ranking: 1 });

    const [group] = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.RANKING });

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-first', 'p-second', 'p-unranked']);
  });

  it('keeps a golfer who withdrew after an earlier assignment in their old tier when tiers are re-run, so picks of them still show in a tier', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    const withdrawn = store.addToField(event.id, 'p-withdrawn', { oddsToWin: 2 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 5 });
    store.addToField(event.id, 'p-long', { oddsToWin: 50 });
    await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS, tierSize: 1 });

    withdrawn.isActive = false;
    const groups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS, tierSize: 1 });

    expect(groups[0].participants.map((placement) => placement.participantId)).toEqual(['p-withdrawn', 'p-fav']);
    expect(groups[1].participants.map((placement) => placement.participantId)).toEqual(['p-long']);
  });

  it('lists a tier\'s golfers by their order index, with any that have none last', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, [TWO_TIERS[0]]);
    const [tier] = store.tierRows;
    const unordered = store.addToField(event.id, 'p-unordered');
    const second = store.addToField(event.id, 'p-second');
    const first = store.addToField(event.id, 'p-first');
    await store.valuationRepo().assignTiers([
      { sportEventParticipantId: unordered.id, sportEventTierId: tier.id, tierOrderIndex: null as unknown as number, source: 'MANUAL' },
      { sportEventParticipantId: second.id, sportEventTierId: tier.id, tierOrderIndex: 2, source: 'MANUAL' },
      { sportEventParticipantId: first.id, sportEventTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' },
    ]);

    const [group] = await service.getEffectiveTiersForSportEvent(event.id);

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-first', 'p-second', 'p-unordered']);
  });

  it('removes an empty tier without asking where its golfers should go', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');
    const [tier1] = store.tierRows;
    await store.valuationRepo().assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier1.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]] });

    expect(groups.map((group) => [group.tierKey, group.participants.map((p) => p.participantId)])).toEqual([['tier-1', ['p-1']]]);
  });

  it('prices nothing and writes nothing when the event has no active golfer', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-withdrawn', { seedNumber: 1, isActive: false });

    await expect(service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() })).resolves.toEqual([]);
    expect(store.valuationRows).toEqual([]);
  });
});
