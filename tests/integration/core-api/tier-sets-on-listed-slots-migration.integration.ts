/**
 * The listed-slot tier set migration (#2044) run on QA-shaped rows in real Postgres: an event whose
 * tiers sit on its tier-set slot gives each later slot an active tiered or budget template lists the
 * same tier definitions, nobody placed, and leaves a slot no such template lists, and one that
 * already has tiers, as they are. The test writes the rows, runs the migration's own statements
 * from its file, reads where everything went, and rolls everything back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { eventRoundSlots, freshEventEdition } from '../../support/event-edition';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218028400_tier_sets_on_listed_slots/migration.sql');

/** SQL split into its statements, comments dropped. */
function statementsOf(sql: string): string[] {
  return sql.split(/;\s*\n/).map((statement) => statement.replace(/^\s*--.*$/gm, '').trim()).filter((statement) => statement.length > 0);
}

class Rollback extends Error {}

describe('tier sets on listed slots migration (#2044)', () => {
  it('copies the tier-set slot\'s tier definitions onto each later slot a tiered template lists, and onto no play-in or slot with tiers of its own', async () => {
    const prisma = getPrisma();
    const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      ...(await freshEventEdition(prisma)),
      name: `Listed Slots ${randomUUID().slice(0, 8)}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      status: 'DRAFT',
      rounds: 4,
      autoLifecycleEnabled: false,
    });
    const [playInSlotId, roundOf64SlotId, roundOf32SlotId, sweet16SlotId] = await eventRoundSlots(prisma, event.id, [
      { slotKind: 'PLAY_IN' }, { slotKind: 'ROUND_OF_64' }, { slotKind: 'ROUND_OF_32' }, { slotKind: 'ROUND_OF_16' },
    ]);
    const definitionOf = async (sportEventSlotId: string) => (await prisma.sportEventSlot.findUniqueOrThrow({
      where: { id: sportEventSlotId }, select: { seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } },
    })).seasonSlot.sportLeagueCompetitionSlotId;
    const listed = await Promise.all([roundOf64SlotId, roundOf32SlotId, sweet16SlotId].map(definitionOf));

    const tiersBySlot = await prisma.$transaction(async (tx) => {
      await tx.contestConfigTemplate.create({
        data: {
          sportLeagueId: event.sportLeagueId, coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', selectionType: 'TIERED', name: 'Pick 4', description: 'Pick 4',
          sortOrder: 1, configJson: {}, templateKey: `listed-${randomUUID()}`, slots: { create: listed.map((sportLeagueCompetitionSlotId) => ({ sportLeagueCompetitionSlotId })) },
        },
      });
      // The tier-set slot's two tiers, as 027800 left them, and a Sweet 16 already given one of its own.
      await tx.sportEventSlotTier.createMany({
        data: [
          { sportEventSlotId: roundOf64SlotId, tierKey: 'tier-1', tierNumber: 1 },
          { sportEventSlotId: roundOf64SlotId, tierKey: 'tier-2', tierNumber: 2 },
          { sportEventSlotId: sweet16SlotId, tierKey: 'tier-1', tierNumber: 1 },
        ],
      });
      for (const statement of statementsOf(readFileSync(MIGRATION, 'utf8'))) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const rows = await tx.sportEventSlotTier.findMany({ where: { slot: { sportEventId: event.id } }, select: { sportEventSlotId: true, tierKey: true }, orderBy: [{ tierNumber: 'asc' }] });
      throw new Rollback(JSON.stringify(rows));
    }, { timeout: 60_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Array<{ sportEventSlotId: string; tierKey: string }>;
      throw error;
    });

    const keysOf = (sportEventSlotId: string) => tiersBySlot.filter((tier) => tier.sportEventSlotId === sportEventSlotId).map((tier) => tier.tierKey);
    expect([keysOf(playInSlotId), keysOf(roundOf64SlotId), keysOf(roundOf32SlotId), keysOf(sweet16SlotId)]).toEqual([[], ['tier-1', 'tier-2'], ['tier-1', 'tier-2'], ['tier-1']]);
  });
});
