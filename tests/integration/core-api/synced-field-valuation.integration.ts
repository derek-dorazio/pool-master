import { expect } from '@jest/globals';
import { ProviderCode, ProviderSyncFindingKind, ProviderSyncFindingStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaParticipantProviderMappingRepository, PrismaParticipantRepository, PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { PrismaProviderSyncFindingRepository } from '../../../packages/core-api/src/adapters/prisma-provider-sync-finding-repository';
import { PrismaSlotNamePatternRepository } from '../../../packages/core-api/src/adapters/prisma-slot-name-pattern-repository';
import { SyncedFieldFollowUps } from '../../../packages/core-api/src/modules/events/synced-field-follow-ups';
import { ProviderSyncFindingService } from '../../../packages/core-api/src/modules/ingestion/findings/provider-sync-finding-service';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import { testDomainEvents } from '../../support/domain-events';
import { createSportEventTierService } from '../../../packages/core-api/src/modules/events/wiring';
import { SyncedFieldValuationService } from '../../../packages/core-api/src/modules/events/synced-field-valuation';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { seedEventWithField } from '../list-route-seeds';
import { mapEventToProvider } from '../../support/event-edition';
import { expectSameStatementCount } from '../query-scaling';
import { recordStatements } from '../statement-log';
import { expectDefined } from '../../support/expect-defined';
import { tierSetSlot } from '../../support/event-tier-sets';
import { standardPricingIn } from '../../support/budget-pricing';

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
  });
}

/** A golf event of `golfers` golfers on two empty tiers, each with the feed's odds unless `withOdds` is false. */
async function syncedEvent(golfers: number, status: SportEventStatus = SportEventStatus.DRAFT, withOdds = true) {
  const { event, field } = await seedEventWithField(golfers, { status });
  if (withOdds) {
    for (const [index, row] of field.entries()) {
      await getPrisma().sportEventParticipant.update({ where: { id: row.id }, data: { oddsToWin: 5 + index } });
    }
  }
  const tierSet = await tierSetSlot(getPrisma(), event.id);
  await getPrisma().sportEventSlotTier.createMany({
    data: [1, 2].map((tierNumber) => ({ sportEventSlotId: tierSet.id, tierKey: `tier-${tierNumber}`, tierNumber })),
  });
  // The provider's id for the event (#2004), which a field sync names it by.
  const ref = { sportEventId: event.id, providerId: 'balldontlie', externalId: `valuation-${event.id}` };
  await mapEventToProvider(getPrisma(), event.id, { providerId: ref.providerId, externalId: ref.externalId });
  return { event, field, ref };
}

function valuationsOf(sportEventId: string) {
  return getPrisma().sportEventSlotParticipantValuation.findMany({ where: { sportEventParticipant: { sportEventId } } });
}

describe('Synced field valuation (#1822)', () => {
  it('tiers and prices a synced draft field by its odds and stores the default pricing profile on the event\'s slot', async () => {
    const { event, ref } = await syncedEvent(4);
    const service = valuationService();

    const { platformPricingProfileId } = await getPrisma().sportLeague.findUniqueOrThrow({ where: { id: event.sportLeagueId }, select: { platformPricingProfileId: true } });

    expect(await service.afterFieldLoad(ref)).toMatchObject({
      outcome: 'VALUED',
      tiers: { result: 'MADE', basis: 'ODDS', tierCount: 2 },
      prices: { result: 'MADE', basis: 'ODDS', pricedCount: 4, platformPricingProfileId },
    });
    const made = await valuationsOf(event.id);
    expect(made).toHaveLength(4);
    expect(made.every((row) => row.sportEventSlotTierId !== null && row.tierAssignedSource === 'AUTO_ODDS' && row.priceAssignedSource === 'AUTO_ODDS')).toBe(true);
    const standard = await standardPricingIn(getPrisma());
    expect(await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id } })).toMatchObject({
      platformPricingProfileId: standard.platformPricingProfileId, salaryCap: 50_000, pricingUnit: 100,
    });
  });

  it('writes nothing when a re-sync finds the same field, and keeps every tier once one is placed by hand', async () => {
    const { event, ref } = await syncedEvent(4);
    const service = valuationService();
    await service.afterFieldLoad(ref);
    const made = await valuationsOf(event.id);

    const repeat = await recordStatements(() => service.afterFieldLoad(ref));
    expect(repeat.result).toMatchObject({ tiers: { result: 'UNCHANGED' }, prices: { result: 'UNCHANGED' } });
    expect(repeat.statements.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toEqual([]);

    await getPrisma().sportEventSlotParticipantValuation.update({ where: { id: expectDefined(made[0]).id }, data: { tierAssignedSource: 'MANUAL' } });
    expect(await service.afterFieldLoad(ref)).toMatchObject({ tiers: { result: 'KEPT_AS_EDITED' }, prices: { result: 'UNCHANGED' } });
  });

  it('writes no tier or price on a field with no odds, seeds or ranks, since a name orders nothing', async () => {
    const { event, ref } = await syncedEvent(4, SportEventStatus.DRAFT, false);

    expect(await valuationService().afterFieldLoad(ref)).toEqual({ outcome: 'SKIPPED', reason: 'NO_ORDER' });
    expect(await valuationsOf(event.id)).toEqual([]);
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

  it('raises a FIELD_HAS_NO_ORDER finding on a synced field with no odds, seeds or ranks, and resolves it once the feed brings odds', async () => {
    const { event, field, ref } = await syncedEvent(3, SportEventStatus.DRAFT, false);
    const provider = await getPrisma().provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE } });
    const followUps = new SyncedFieldFollowUps({
      providerGames: { afterFieldLoad: async () => null },
      valuation: valuationService(),
      sportEvents: new PrismaSportEventRepository(getAppPrisma()),
      findings: new ProviderSyncFindingService({
        repository: new PrismaProviderSyncFindingRepository(getPrisma()),
        providers: { all: () => [{ ...provider, leagues: [] }] },
        participants: new ParticipantService(new PrismaParticipantRepository(getPrisma()), new PrismaParticipantProviderMappingRepository(getPrisma()), testDomainEvents()),
        slotNamePatterns: new PrismaSlotNamePatternRepository(getPrisma()),
        now: () => new Date(),
      }),
    });
    const findings = () => getPrisma().providerSyncFinding.findMany({ where: { sportEventId: event.id, kind: ProviderSyncFindingKind.FIELD_HAS_NO_ORDER } });

    await followUps.run(ref);
    expect(await findings()).toEqual([expect.objectContaining({ status: ProviderSyncFindingStatus.OPEN, sportLeagueId: event.sportLeagueId, providerId: provider.id })]);

    for (const [index, row] of field.entries()) {
      await getPrisma().sportEventParticipant.update({ where: { id: row.id }, data: { oddsToWin: 5 + index } });
    }
    await followUps.run(ref);
    expect((await findings()).map((row) => row.status)).toEqual([ProviderSyncFindingStatus.RESOLVED]);
  });
});
