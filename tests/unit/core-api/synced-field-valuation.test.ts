import { SportEventStatus, type BudgetPricingProfile } from '@poolmaster/shared/domain';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  SyncedFieldValuationService,
  fieldValuationReport,
} from '../../../packages/core-api/src/modules/events/synced-field-valuation';
import { IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, IN_MEMORY_PLATFORM_TIER_PROFILE_ID, InMemorySportEvents } from '../../support/in-memory-sport-events';
import { standardEventPricing } from '../../support/budget-pricing';
import { expectDefined } from '../../support/expect-defined';

// Tiers and prices made from the feed after each field sync (#1822), against an in-memory store:
// what a draft gets, what a released event and an admin's hand edits keep, and what the run reports.

const SYNCED = { providerId: 'balldontlie', externalId: 'game-week-12' };

function tierDefinitions(count: number) {
  return Array.from({ length: count }, (_, index) => ({ tierKey: `tier-${index + 1}`, tierNumber: index + 1 }));
}

/** A synced draft of `fieldSize` with `tierCount` tiers, in a league naming Standard pricing or `pricing`. */
async function setup(options: { status?: SportEventStatus; fieldSize?: number; tierCount?: number; pricing?: BudgetPricingProfile } = {}) {
  const store = new InMemorySportEvents();
  const league = options.pricing && store.addLeagueWithPlatformPricingProfile(options.pricing);
  const event = store.addEvent({ status: options.status ?? SportEventStatus.DRAFT, providerRef: SYNCED, ...(league && { sportLeagueId: league.id }) });
  await store.addTiers(event.id, tierDefinitions(options.tierCount ?? 2));
  for (let index = 1; index <= (options.fieldSize ?? 4); index++) {
    // p-01 has the shortest odds.
    store.addToField(event.id, `p-${String(index).padStart(2, '0')}`, { oddsToWin: index * 5 });
  }
  const tiers = new SportEventTierService({
    sportEvents: store.sportEventRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    platformTierProfiles: store.platformTierProfileRepo(),
    platformPricingProfiles: store.platformPricingProfileRepo(),
  });
  const valuation = new SyncedFieldValuationService({ sportEvents: store.sportEventRepo(), tiers });
  return { store, event, tiers, valuation, league };
}

function tierOf(store: InMemorySportEvents, participantId: string) {
  const entry = store.field.find((row) => row.participantId === participantId);
  const row = store.valuationRows.find((candidate) => candidate.sportEventParticipantId === entry?.id);
  return store.tierRows.find((tier) => tier.id === row?.sportEventTierId)?.tierKey ?? null;
}

describe('SyncedFieldValuationService — a field sync makes tiers and prices on a draft', () => {
  it('tiers a synced draft field by odds over the event\'s own tiers and prices it with its sport league\'s pricing profile (Standard)', async () => {
    const { store, event, valuation } = await setup();

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toEqual({
      outcome: 'VALUED',
      sportEventId: event.id,
      tiers: { result: 'MADE', basis: 'ODDS', tierCount: 2 },
      prices: { result: 'MADE', basis: 'ODDS', pricedCount: 4, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID },
    });
    expect(['p-01', 'p-02', 'p-03', 'p-04'].map((id) => tierOf(store, id))).toEqual(['tier-1', 'tier-1', 'tier-2', 'tier-2']);
    expect(store.valuationRows.every((row) => row.tierAssignedSource === 'AUTO_ODDS' && row.priceAssignedSource === 'AUTO_ODDS')).toBe(true);
    const prices = store.valuationRows.map((row) => row.price as number);
    expect(prices).toEqual([...prices].sort((left, right) => right - left));
    expect((await store.sportEventRepo().findById(event.id))?.pricingConfig).toEqual(standardEventPricing());
  });

  it('re-makes the tiers when a later sync moves the odds, so the new favourite leads tier 1', async () => {
    const { store, event, valuation } = await setup();
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    const longest = store.field.find((row) => row.participantId === 'p-04');
    Object.assign(longest as object, { oddsToWin: 1 });
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(tierOf(store, 'p-04')).toBe('tier-1');
    expect(tierOf(store, 'p-02')).toBe('tier-2');
  });

  it('writes nothing on a sync of an unchanged field, and reports the tiers and prices as unchanged', async () => {
    const { store, event, valuation } = await setup();
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });
    const valuations = store.valuationRepo();
    const assignTiers = jest.spyOn(valuations, 'assignEventTiers');
    const assignEventPrices = jest.spyOn(valuations, 'assignEventPrices');
    const watched = new SportEventTierService({
      sportEvents: store.sportEventRepo(),
      tiers: store.tierRepo(),
      valuations,
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      platformTierProfiles: store.platformTierProfileRepo(),
      platformPricingProfiles: store.platformPricingProfileRepo(),
    });

    const outcome = await watched.valueSyncedField(expectDefined(await store.sportEventRepo().findById(event.id)));

    expect(outcome).toMatchObject({ tiers: { result: 'UNCHANGED', tierCount: 2 }, prices: { result: 'UNCHANGED', pricedCount: 4 } });
    expect(assignTiers).not.toHaveBeenCalled();
    expect(assignEventPrices).not.toHaveBeenCalled();
  });

  it('prices a never-priced field with the pricing profile its own sport league names, not the first profile there is', async () => {
    const small = { name: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
    const { store, event, valuation, league } = await setup({ pricing: small });
    const platformPricingProfileId = expectDefined(league).platformPricingProfileId;

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ prices: { result: 'MADE', platformPricingProfileId } });
    expect((await store.sportEventRepo().findById(event.id))?.pricingConfig).toEqual({
      platformPricingProfileId, salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4,
    });
    expect(store.valuationRows.every((row) => (row.price as number) <= 5000 && (row.price as number) % 10 === 0)).toBe(true);
  });

  it('records on the event the tier layout it was tiered with, named for the league\'s tier profile', async () => {
    const { store, event, valuation } = await setup();

    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect((await store.sportEventRepo().findById(event.id))?.tierConfig).toEqual({
      platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, type: 'EQUAL_GROUPS', tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null,
    });
  });

  it('prices a re-sync with the values the event was last priced with, not the default profile', async () => {
    const { store, event, tiers, valuation } = await setup();
    const small = { ...standardEventPricing(), salaryCap: 5000, unit: 10 };
    await tiers.autoAssignPrices({ sportEventId: event.id, pricingConfig: small });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ prices: { platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, pricedCount: 4 } });
    expect((await store.sportEventRepo().findById(event.id))?.pricingConfig).toEqual(small);
    expect(Math.max(...store.valuationRows.map((row) => row.price as number))).toBeLessThanOrEqual(5000);
  });
});

describe('SyncedFieldValuationService — what a field sync leaves alone', () => {
  it('leaves a released event\'s tiers and prices untouched, since release locks them (#431)', async () => {
    const { store, event, valuation } = await setup({ status: SportEventStatus.SCHEDULED });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toEqual({ outcome: 'SKIPPED', reason: 'LOCKED' });
    expect(store.valuationRows).toEqual([]);
  });

  it('keeps every tier as an admin placed them once one was dragged by hand, while still pricing the field', async () => {
    const { store, event, tiers, valuation } = await setup();
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });
    const longest = expectDefined(store.field.find((row) => row.participantId === 'p-04'));
    await tiers.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: longest.id, tierKey: 'tier-1', tierOrderIndex: 1 }] });
    Object.assign(store.field.find((row) => row.participantId === 'p-03') as object, { oddsToWin: 1 });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ tiers: { result: 'KEPT_AS_EDITED' }, prices: { result: 'MADE' } });
    expect(tierOf(store, 'p-04')).toBe('tier-1');
    expect(tierOf(store, 'p-03')).toBe('tier-2');
  });

  it('keeps every price as an admin typed them once one was set by hand in the field grid, while still tiering the field', async () => {
    const { store, event, valuation } = await setup();
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });
    const favourite = expectDefined(store.field.find((row) => row.participantId === 'p-01'));
    await store.valuationRepo().assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: favourite.id, price: 777, source: 'MANUAL' }],
    });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ tiers: { result: 'UNCHANGED' }, prices: { result: 'KEPT_AS_EDITED' } });
    expect(store.valuationRows.find((row) => row.sportEventParticipantId === favourite.id)?.price).toBe(777);
  });

  it('warns that participants the field gains after a hand edit have no tier and no price, leaving them for an admin', async () => {
    const { store, event, tiers, valuation } = await setup();
    await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });
    const favourite = expectDefined(store.field.find((row) => row.participantId === 'p-01'));
    await tiers.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: favourite.id, tierKey: 'tier-2', tierOrderIndex: 1 }] });
    await store.valuationRepo().assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: favourite.id, price: 777, source: 'MANUAL' }],
    });
    store.addToField(event.id, 'p-late', { oddsToWin: 2 });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ tiers: { result: 'KEPT_AS_EDITED', untiered: 1 }, prices: { result: 'KEPT_AS_EDITED', unpriced: 1 } });
    expect(fieldValuationReport(outcome).warnings.map((warning) => warning.code)).toEqual(['FIELD_ROWS_UNTIERED', 'FIELD_ROWS_UNPRICED']);
    expect(tierOf(store, 'p-late')).toBeNull();
  });

  it('re-makes tiers an admin made with the auto-assign button, since a button press is not a hand edit', async () => {
    const { store, event, tiers, valuation } = await setup();
    await tiers.autoAssignTiers({ sportEventId: event.id, tierSize: 3 });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome).toMatchObject({ tiers: { result: 'MADE' } });
    expect(tierOf(store, 'p-03')).toBe('tier-2');
  });

  it('skips an event with no active field and an event that no longer exists', async () => {
    const { store, event, valuation } = await setup({ fieldSize: 0 });

    expect(await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED })).toEqual({ outcome: 'SKIPPED', reason: 'NO_FIELD' });
    expect(await valuation.afterFieldLoad({ sportEventId: 'an-event-not-in-the-store', ...SYNCED })).toEqual({ outcome: 'SKIPPED', reason: 'NO_EVENT' });
    expect(store.valuationRows).toEqual([]);
  });

  it('skips a field with no odds, seeds or ranks, making no tiers or prices, since a name orders nothing', async () => {
    const { store, event, valuation } = await setup({ fieldSize: 0 });
    for (const id of ['p-01', 'p-02']) store.addToField(event.id, id);

    expect(await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED })).toEqual({ outcome: 'SKIPPED', reason: 'NO_ORDER' });
    expect(store.valuationRows).toEqual([]);
  });

  it('prices but does not tier an event that has no tiers', async () => {
    const { event, valuation } = await setup({ tierCount: 0 });

    expect(await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED })).toMatchObject({ tiers: { result: 'NO_TIERS' }, prices: { result: 'MADE' } });
  });

  it('answers a bad pricing profile as a failure, writing no tier or price, instead of throwing, so the field sync that wrote the field still completes', async () => {
    const { store, event, valuation } = await setup();
    Object.assign(expectDefined(store.platformPricingProfiles[0]), { floorSharePercent: 90 });

    const outcome = await valuation.afterFieldLoad({ sportEventId: event.id, ...SYNCED });

    expect(outcome.outcome).toBe('FAILED');
    expect(outcome.outcome === 'FAILED' && outcome.message).toContain('share');
    // The pricing values are checked first, so a bad profile leaves the tiers unmade too.
    expect(store.valuationRows).toEqual([]);
  });
});

describe('fieldValuationReport — what the field sync run shows', () => {
  it('reports tiers made from odds as the tier count and prices made as the count priced', () => {
    expect(fieldValuationReport({
      outcome: 'VALUED',
      sportEventId: 'e',
      tiers: { result: 'MADE', basis: 'ODDS', tierCount: 6 },
      prices: { result: 'MADE', basis: 'RANKING', pricedCount: 64, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID },
    })).toEqual({ stats: { tiersMadeFromOdds: 6, pricesMadeFromRank: 64 }, warnings: [] });
  });

  it.each([
    [{ outcome: 'VALUED' as const, sportEventId: 'e', tiers: { result: 'UNCHANGED' as const, basis: 'SEED' as const, tierCount: 4 }, prices: { result: 'KEPT_AS_EDITED' as const, unpriced: 0 } }, { tiersUnchanged: 4, pricesKeptAsEdited: 1 }],
    [{ outcome: 'VALUED' as const, sportEventId: 'e', tiers: { result: 'KEPT_AS_EDITED' as const, untiered: 0 }, prices: { result: 'UNCHANGED' as const, basis: 'RANKING' as const, pricedCount: 9, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID } }, { tiersKeptAsEdited: 1, pricesUnchanged: 9 }],
    [{ outcome: 'SKIPPED' as const, reason: 'LOCKED' as const }, { tiersAndPricesLocked: 1 }],
    [{ outcome: 'SKIPPED' as const, reason: 'NO_EVENT' as const }, {}],
  ])('counts outcome %j in the run\'s stats as %j, with no warning', (outcome, stats) => {
    expect(fieldValuationReport(outcome)).toEqual({ stats, warnings: [] });
  });

  it('reports a field with no order as a warning that no tiers or prices were made', () => {
    expect(fieldValuationReport({ outcome: 'SKIPPED', reason: 'NO_ORDER' })).toEqual({
      stats: {},
      warnings: [{ code: 'TIERS_AND_PRICES_NOT_MADE', message: 'Tiers and prices were not made from the field: no participant has a value for any source its league\'s profiles list to put it in order.' }],
    });
  });

  it('reports an event with no tiers and a failure as warnings on the run', () => {
    expect(fieldValuationReport({
      outcome: 'VALUED', sportEventId: 'e', tiers: { result: 'NO_TIERS' }, prices: { result: 'MADE', basis: 'SEED', pricedCount: 3, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID },
    }).warnings).toEqual([expect.objectContaining({ code: 'EVENT_HAS_NO_TIERS' })]);
    expect(fieldValuationReport({ outcome: 'FAILED', message: 'boom' }))
      .toEqual({ stats: {}, warnings: [{ code: 'TIERS_AND_PRICES_NOT_MADE', message: 'Tiers and prices were not made from the field: boom' }] });
  });
});
