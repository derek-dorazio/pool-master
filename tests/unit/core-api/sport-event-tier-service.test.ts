import { Sport, SportEventStatus, TierSource } from '@poolmaster/shared/domain';
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

function tierDefinitions(count: number) {
  return Array.from({ length: count }, (_, index) => ({ tierKey: `tier-${index + 1}`, label: `Tier ${index + 1}`, tierNumber: index + 1 }));
}

/** `count` active participants, p-01 the shortest odds. */
function addFieldByOdds(store: InMemorySportEvents, sportEventId: string, count: number) {
  for (let index = 1; index <= count; index++) {
    store.addToField(sportEventId, `p-${String(index).padStart(2, '0')}`, { oddsToWin: index });
  }
}

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
  it('creates the sport\'s default tiers once (six for golf), and leaves an event that has tiers alone', async () => {
    const { store, event, service } = setup();

    await service.ensureDefaultTiers(event.id, Sport.GOLF);
    const again = await service.ensureDefaultTiers(event.id, Sport.GOLF);

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

  it('places the sport\'s default tier size (ten for golf) in each tier when no size is sent and the event keeps the sport\'s six tiers, the last tier taking the rest', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, tierDefinitions(6));
    addFieldByOdds(store, event.id, 62);

    const groups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([10, 10, 10, 10, 10, 12]);
  });

  it('keeps horse racing\'s three-three-rest layout when no size is sent and the race keeps its three default tiers', async () => {
    const { store, service } = setup();
    const race = store.addEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING });
    await store.tierRepo().createMany(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 14);

    const groups = await service.autoAssignTiers({ sportEventId: race.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([3, 3, 8]);
  });

  it('spreads a field too small for the sport\'s layout evenly on the default tiers so release finds no empty tier: 6 horses on three tiers is 2/2/2, 30 golfers on six is 5 each', async () => {
    const { store, event, service } = setup();
    const race = store.addEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING });
    await store.tierRepo().createMany(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 6);

    const raceGroups = await service.autoAssignTiers({ sportEventId: race.id, source: TierSource.ODDS });

    expect(raceGroups.map((group) => group.participants.length)).toEqual([2, 2, 2]);

    await store.tierRepo().createMany(event.id, tierDefinitions(6));
    addFieldByOdds(store, event.id, 30);

    const golfGroups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS });

    expect(golfGroups.map((group) => group.participants.length)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('keeps the sport\'s layout when it just fills every default tier: 7 horses on three tiers is 3/3/1', async () => {
    const { store, service } = setup();
    const race = store.addEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING });
    await store.tierRepo().createMany(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 7);

    const groups = await service.autoAssignTiers({ sportEventId: race.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([3, 3, 1]);
  });

  it('spreads a 22-driver field over a race set to four tiers as 6/6/5/5 when no size is sent, leaving no tier empty', async () => {
    const { store, service } = setup();
    const race = store.addEvent({ status: SportEventStatus.DRAFT, sport: Sport.AUTO_RACING });
    await store.tierRepo().createMany(race.id, tierDefinitions(4));
    addFieldByOdds(store, race.id, 22);

    const groups = await service.autoAssignTiers({ sportEventId: race.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([6, 6, 5, 5]);
    expect(groups[0].participants.map((placement) => placement.participantId)).toEqual(['p-01', 'p-02', 'p-03', 'p-04', 'p-05', 'p-06']);
    expect(groups[3].participants.map((placement) => placement.participantId)).toEqual(['p-18', 'p-19', 'p-20', 'p-21', 'p-22']);
  });

  it('spreads 33 golfers over five tiers as 7/7/7/6/6 and 176 as 36/35/35/35/35 when no size is sent, larger tiers first', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, tierDefinitions(5));
    addFieldByOdds(store, event.id, 33);

    const groups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([7, 7, 7, 6, 6]);

    const big = store.addEvent({ status: SportEventStatus.DRAFT });
    await store.tierRepo().createMany(big.id, tierDefinitions(5));
    addFieldByOdds(store, big.id, 176);

    const bigGroups = await service.autoAssignTiers({ sportEventId: big.id, source: TierSource.ODDS });

    expect(bigGroups.map((group) => group.participants.length)).toEqual([36, 35, 35, 35, 35]);
  });

  it('leaves the trailing tiers empty when the field is smaller than the tier count and no size is sent', async () => {
    const { store, event, service } = setup();
    await store.tierRepo().createMany(event.id, tierDefinitions(5));
    addFieldByOdds(store, event.id, 3);

    const groups = await service.autoAssignTiers({ sportEventId: event.id, source: TierSource.ODDS });

    expect(groups.map((group) => group.participants.length)).toEqual([1, 1, 1, 0, 0]);
  });

  it('fills a sent tier size exactly as before, even when that leaves the last tier empty (22 drivers in fours of 8 is 8/8/6/0)', async () => {
    const { store, service } = setup();
    const race = store.addEvent({ status: SportEventStatus.DRAFT, sport: Sport.AUTO_RACING });
    await store.tierRepo().createMany(race.id, tierDefinitions(4));
    addFieldByOdds(store, race.id, 22);

    const groups = await service.autoAssignTiers({ sportEventId: race.id, source: TierSource.ODDS, tierSize: 8 });

    expect(groups.map((group) => group.participants.length)).toEqual([8, 8, 6, 0]);
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

  it('prices a field with odds and no seeds from the favourite down, so a race priced from its morning line follows the market', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-long', { oddsToWin: 30 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 2.5 });
    store.addToField(event.id, 'p-mid', { oddsToWin: 8 });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() });

    const priceOf = Object.fromEntries(views.map((view) => [view.participantId, view.price]));
    expect(priceOf['p-fav']).toBeGreaterThan(priceOf['p-mid'] ?? Infinity);
    expect(priceOf['p-mid']).toBeGreaterThan(priceOf['p-long'] ?? Infinity);
  });

  it('prices seeded participants by seed first, and unseeded ones after them by odds', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-guest-long', { oddsToWin: 40 });
    store.addToField(event.id, 'p-seed-2', { seedNumber: 2, oddsToWin: 3 });
    store.addToField(event.id, 'p-guest-short', { oddsToWin: 6 });
    store.addToField(event.id, 'p-seed-1', { seedNumber: 1, oddsToWin: 10 });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricingConfig: standardEventPricing() });

    const byPrice = [...views].sort((left, right) => (right.price ?? 0) - (left.price ?? 0)).map((view) => view.participantId);
    expect(byPrice).toEqual(['p-seed-1', 'p-seed-2', 'p-guest-short', 'p-guest-long']);
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
    // The worst seed's price is $6,000 (12% of $50,000): a $20,000 unit would round it to $0.
    ['a rounding unit above the worst golfer\'s price, which would round it to $0', { unit: 20_000 }],
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
    await store.valuationRepo().assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: entry.id, price: 12, source: 'MANUAL' }],
    });

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
