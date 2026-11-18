import { expect } from '@jest/globals';
import { DEFAULT_BUDGET_PRICING_PROFILES, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { createSportEventTierService } from '../../../packages/core-api/src/modules/events/wiring';
import { SyncedFieldValuationService } from '../../../packages/core-api/src/modules/events/synced-field-valuation';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { seedEventWithField } from '../list-route-seeds';
import { expectSameStatementCount } from '../query-scaling';
import { recordStatements } from '../statement-log';
import { expectDefined } from '../../support/expect-defined';

// Tiers and prices made from the feed after each field sync (#1822), against real Postgres: the
// valuations and the event's pricing values written through the adapters, a hand edit kept, a
// released event left alone, and a cost in statements that does not grow with the field.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function valuationService() {
  return new SyncedFieldValuationService({
    sportEvents: new PrismaSportEventRepository(getAppPrisma()),
    tiers: createSportEventTierService(getAppPrisma()),
    readPricingProfiles: () => ({ profiles: DEFAULT_BUDGET_PRICING_PROFILES.map((profile) => ({ ...profile })) }),
  });
}

/** A golf event of `golfers` golfers with no odds, seeds or ranks, on two empty tiers. */
async function syncedEvent(golfers: number, status: SportEventStatus = SportEventStatus.DRAFT) {
  const { event, field } = await seedEventWithField(golfers, { status });
  await getPrisma().sportEventTier.createMany({
    data: [1, 2].map((tierNumber) => ({ sportEventId: event.id, tierKey: `tier-${tierNumber}`, label: `Tier ${tierNumber}`, tierNumber })),
  });
  return { event, field, ref: { providerId: event.providerId, externalId: event.externalId } };
}

function valuationsOf(sportEventId: string) {
  return getPrisma().sportEventParticipantValuation.findMany({ where: { sportEventParticipant: { sportEventId } } });
}

describe('Synced field valuation (#1822)', () => {
  it('tiers and prices a synced draft field by name and stores the default pricing profile on the event', async () => {
    const { event, ref } = await syncedEvent(4);
    const service = valuationService();

    expect(await service.afterFieldLoad(ref)).toMatchObject({
      outcome: 'VALUED',
      tiers: { result: 'MADE', basis: 'NAME', tierCount: 2 },
      prices: { result: 'MADE', basis: 'NAME', pricedCount: 4, profileName: 'Standard' },
    });
    const made = await valuationsOf(event.id);
    expect(made).toHaveLength(4);
    expect(made.every((row) => row.sportEventTierId !== null && row.tierAssignedSource === 'AUTO_NAME' && row.priceAssignedSource === 'AUTO_NAME')).toBe(true);
    expect((await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } })).pricingConfig).toMatchObject({ profileName: 'Standard', salaryCap: 50_000 });
  });

  it('writes nothing when a re-sync finds the same field, and keeps every tier once one is placed by hand', async () => {
    const { event, ref } = await syncedEvent(4);
    const service = valuationService();
    await service.afterFieldLoad(ref);
    const made = await valuationsOf(event.id);

    const repeat = await recordStatements(() => service.afterFieldLoad(ref));
    expect(repeat.result).toMatchObject({ tiers: { result: 'UNCHANGED' }, prices: { result: 'UNCHANGED' } });
    expect(repeat.statements.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toEqual([]);

    await getPrisma().sportEventParticipantValuation.update({ where: { id: expectDefined(made[0]).id }, data: { tierAssignedSource: 'MANUAL' } });
    expect(await service.afterFieldLoad(ref)).toMatchObject({ tiers: { result: 'KEPT_AS_EDITED' }, prices: { result: 'UNCHANGED' } });
  });

  it('writes no tier or price on a released event', async () => {
    const { event, ref } = await syncedEvent(4, SportEventStatus.SCHEDULED);

    expect(await valuationService().afterFieldLoad(ref)).toEqual({ outcome: 'SKIPPED', reason: 'LOCKED' });
    expect(await valuationsOf(event.id)).toEqual([]);
  });

  it('tiers and prices a field of 20 in the same statements as a field of 2', async () => {
    const service = valuationService();
    await expectSameStatementCount({
      seed: async (golfers) => (await syncedEvent(golfers)).ref,
      call: (ref) => service.afterFieldLoad(ref),
      rowsShown: (outcome) => (outcome.outcome === 'VALUED' && outcome.prices.result === 'MADE' ? outcome.prices.pricedCount : 0),
    });
  });
});
