/**
 * The tier set migration (#2044) run on QA-shaped rows in real Postgres: an event's tiers,
 * valuations and tier and pricing settings, made when they were the event's, move onto the event's
 * first slot in play order, with the profiles the event named by id (#2205); an event with no slot
 * loses them. The test puts the tables back as
 * they were before the migration, inserts the rows, runs the migration's own statements from its
 * file, reads where everything went, and rolls everything back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { eventRoundSlots, freshEventEdition } from '../../support/event-edition';
import { participantLeagueId } from '../../support/participant-league';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218026800_tiers_on_event_slots/migration.sql');

/** SQL split into its statements, comments dropped. */
function statementsOf(sql: string): string[] {
  return sql.split(/;\s*\n/).map((statement) => statement.replace(/^\s*--.*$/gm, '').trim()).filter((statement) => statement.length > 0);
}

/** The tables as they were before the migration: tiers and valuations on the event, its settings as JSON. */
const PUT_BACK = `
ALTER TABLE "sport_event_slots" DROP COLUMN "floor_share_percent", DROP COLUMN "platform_pricing_profile_id", DROP COLUMN "platform_tier_profile_id",
  DROP COLUMN "pricing_unit", DROP COLUMN "salary_cap", DROP COLUMN "steepness", DROP COLUMN "tier_size", DROP COLUMN "top_share_percent";
DROP TABLE "sport_event_slot_participant_valuations";
DROP TABLE "sport_event_slot_tiers";
ALTER TABLE "sport_events" ADD COLUMN "pricing_config" JSONB, ADD COLUMN "tier_config" JSONB,
  ADD COLUMN "platform_pricing_profile_id" UUID, ADD COLUMN "platform_tier_profile_id" UUID;
CREATE INDEX "sport_events_platform_pricing_profile_id_idx" ON "sport_events"("platform_pricing_profile_id");
CREATE INDEX "sport_events_platform_tier_profile_id_idx" ON "sport_events"("platform_tier_profile_id");
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_platform_pricing_profile_id_fkey" FOREIGN KEY ("platform_pricing_profile_id") REFERENCES "platform_pricing_profiles"("id") ON DELETE SET NULL;
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_platform_tier_profile_id_fkey" FOREIGN KEY ("platform_tier_profile_id") REFERENCES "platform_tier_profiles"("id") ON DELETE SET NULL;
CREATE TABLE "sport_event_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_id" UUID NOT NULL REFERENCES "sport_events"("id"),
  "tier_key" VARCHAR(50) NOT NULL,
  "tier_number" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "sport_event_tiers_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "sport_event_participant_valuations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_participant_id" UUID NOT NULL UNIQUE REFERENCES "sport_event_participants"("id"),
  "sport_event_tier_id" UUID REFERENCES "sport_event_tiers"("id"),
  "tier_order_index" INTEGER,
  "tier_assigned_source" "ValuationSource",
  "price" DECIMAL(10,2),
  "price_assigned_source" "ValuationSource",
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "sport_event_participant_valuations_pkey" PRIMARY KEY ("id")
);
`;

async function eventOf(name: string) {
  return createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(getPrisma())),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2026-06-04T12:00:00.000Z'),
    status: 'DRAFT',
    rounds: 2,
    autoLifecycleEnabled: false,
  });
}

/** A field row of the event for a new golfer of its league. */
async function fieldRowOf(event: { id: string; sportLeagueId: string }) {
  const prisma = getPrisma();
  const { sportId } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: event.sportLeagueId }, select: { sportId: true } });
  const golfer = await prisma.participant.create({
    data: { sportLeagueId: await participantLeagueId(prisma, sportId), name: `Migrated Golfer ${randomUUID().slice(0, 8)}`, participantType: 'INDIVIDUAL' },
  });
  return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: golfer.id } });
}

class Rollback extends Error {}

interface SlotRow {
  id: string;
  platformTierProfileId: string | null;
  tierSize: number | null;
  platformPricingProfileId: string | null;
  salaryCap: number | null;
  pricingUnit: number | null;
  topSharePercent: number | null;
  floorSharePercent: number | null;
  steepness: number | null;
}

interface Migrated {
  tiers: { id: string; sportEventSlotId: string; tierKey: string; tierNumber: number }[];
  valuations: { id: string; sportEventId: string; sportEventSlotId: string; sportEventParticipantId: string; sportEventSlotTierId: string | null; price: string | null }[];
  slots: SlotRow[];
  eventColumns: string[];
}

describe('the tier set migration', () => {
  it('moves an event\'s tiers, valuations and settings onto its first slot in play order, keeping their ids and the profile it priced from, and drops an unslotted event\'s', async () => {
    const prisma = getPrisma();
    const bracket = await eventOf('Two Slot Cup');
    // Made out of play order, so the first slot follows the slots' kinds, not when they were made.
    const [finalSlotId, semifinalSlotId] = await eventRoundSlots(prisma, bracket.id, [{ slotKind: 'FINAL' }, { slotKind: 'SEMIFINAL' }]);
    const noSlot = await eventOf('No Slot Classic');
    const [bracketRow, noSlotRow] = [await fieldRowOf(bracket), await fieldRowOf(noSlot)];
    const league = await prisma.sportLeague.findUniqueOrThrow({
      where: { id: bracket.sportLeagueId },
      select: { platformTierProfileId: true, platformPricingProfileId: true, platformTierProfile: { select: { type: true, tierSize: true } } },
    });
    // An admin's own tier size for the league's equal-groups profile, which the slot keeps; the
    // profile's own size would be stored as null.
    expect(league.platformTierProfile.type).toBe('EQUAL_GROUPS');
    const sentTierSize = (league.platformTierProfile.tierSize ?? 0) + 1;
    const tierConfig = { type: league.platformTierProfile.type, tierCount: 2, tierSize: sentTierSize, lastTier: 'ALL_REMAINING', lastTierMax: null };
    const pricingConfig = { salaryCap: 40_000, unit: 50, topSharePercent: 20, floorSharePercent: 10, steepness: 3 };
    // The event was priced from another profile than its league's, which the slot keeps.
    const pricedFrom = await prisma.platformPricingProfile.findFirstOrThrow({ where: { id: { not: league.platformPricingProfileId } }, select: { id: true } });
    const [tierOne, tierTwo, unslottedTier, bracketValuation, unslottedValuation] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    const migrated = await prisma.$transaction(async (tx) => {
      for (const statement of statementsOf(PUT_BACK)) {
        // poolmaster-allow-query-in-loop: the put-back statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_events" SET "tier_config" = ${JSON.stringify(tierConfig)}::jsonb, "platform_tier_profile_id" = ${league.platformTierProfileId}::uuid,
        "pricing_config" = ${JSON.stringify(pricingConfig)}::jsonb, "platform_pricing_profile_id" = ${pricedFrom.id}::uuid WHERE "id" = ${bracket.id}::uuid`;
      await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_tiers" ("id", "sport_event_id", "tier_key", "tier_number", "updated_at") VALUES
        (${tierOne}::uuid, ${bracket.id}::uuid, 'tier-1', 1, now()), (${tierTwo}::uuid, ${bracket.id}::uuid, 'tier-2', 2, now()), (${unslottedTier}::uuid, ${noSlot.id}::uuid, 'tier-1', 1, now())`;
      await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_valuations" ("id", "sport_event_participant_id", "sport_event_tier_id", "tier_order_index", "tier_assigned_source", "price", "price_assigned_source", "updated_at") VALUES
        (${bracketValuation}::uuid, ${bracketRow.id}::uuid, ${tierTwo}::uuid, 1, 'AUTO_ODDS', 9000, 'AUTO_ODDS', now()),
        (${unslottedValuation}::uuid, ${noSlotRow.id}::uuid, ${unslottedTier}::uuid, 1, 'MANUAL', NULL, NULL, now())`;
      for (const statement of statementsOf(readFileSync(MIGRATION, 'utf8'))) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const events = [bracket.id, noSlot.id];
      const result: Migrated = {
        tiers: await tx.sportEventSlotTier.findMany({ where: { slot: { sportEventId: { in: events } } }, select: { id: true, sportEventSlotId: true, tierKey: true, tierNumber: true }, orderBy: { tierNumber: 'asc' } }),
        valuations: (await tx.sportEventSlotParticipantValuation.findMany({ where: { sportEventId: { in: events } } }))
          .map((row) => ({ id: row.id, sportEventId: row.sportEventId, sportEventSlotId: row.sportEventSlotId, sportEventParticipantId: row.sportEventParticipantId, sportEventSlotTierId: row.sportEventSlotTierId, price: row.price?.toString() ?? null })),
        slots: await tx.sportEventSlot.findMany({
          where: { sportEventId: bracket.id },
          select: { id: true, platformTierProfileId: true, tierSize: true, platformPricingProfileId: true, salaryCap: true, pricingUnit: true, topSharePercent: true, floorSharePercent: true, steepness: true },
        }),
        eventColumns: (await tx.$queryRaw<{ name: string }[]>`${uncachedStatement()} SELECT "column_name" AS "name" FROM information_schema.columns WHERE "table_name" = 'sport_events' AND "column_name" IN ('tier_config', 'pricing_config', 'platform_tier_profile_id', 'platform_pricing_profile_id')`).map((column) => column.name),
      };
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 60_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated.tiers).toEqual([
      { id: tierOne, sportEventSlotId: semifinalSlotId, tierKey: 'tier-1', tierNumber: 1 },
      { id: tierTwo, sportEventSlotId: semifinalSlotId, tierKey: 'tier-2', tierNumber: 2 },
    ]);
    expect(migrated.valuations).toEqual([
      { id: bracketValuation, sportEventId: bracket.id, sportEventSlotId: semifinalSlotId, sportEventParticipantId: bracketRow.id, sportEventSlotTierId: tierTwo, price: '9000' },
    ]);
    const slotById = new Map(migrated.slots.map((slot) => [slot.id, slot]));
    expect(slotById.get(semifinalSlotId)).toEqual({
      id: semifinalSlotId,
      platformTierProfileId: league.platformTierProfileId,
      tierSize: sentTierSize,
      platformPricingProfileId: pricedFrom.id,
      salaryCap: 40_000, pricingUnit: 50, topSharePercent: 20, floorSharePercent: 10, steepness: 3,
    });
    expect(slotById.get(finalSlotId)).toEqual({
      id: finalSlotId, platformTierProfileId: null, tierSize: null, platformPricingProfileId: null,
      salaryCap: null, pricingUnit: null, topSharePercent: null, floorSharePercent: null, steepness: null,
    });
    expect(migrated.eventColumns).toEqual([]);
  });
});
