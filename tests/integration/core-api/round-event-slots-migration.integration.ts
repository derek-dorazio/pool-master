/**
 * The round slot migration (#2006) run on QA-shaped rows in real Postgres: rounds made before
 * rounds had slots, in a one-slot event, an event with a slot per round, an event with more rounds
 * than slots, and an event with no slot. The test puts the table back as it was before the
 * migration, inserts the rows, runs the migration's own statements from its file, checks where
 * each round went, and rolls everything back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { eventRoundSlots, freshEventEdition } from '../../support/event-edition';
import { linkTestSlot } from '../../support/test-slots';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218021500_round_event_slots/migration.sql');

/** The migration's statements that place the rounds and delete the ones it cannot place. */
function placingStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('-- An event with one slot');
  const end = sql.indexOf('DROP TABLE "unplaced_matches";') + 'DROP TABLE "unplaced_matches";'.length;
  return sql.slice(start, end).split(/;\s*\n/).map((statement) => statement.replace(/^\s*--.*$/gm, '').trim()).filter((statement) => statement.length > 0);
}

async function eventOf(name: string) {
  return createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(getPrisma())),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2026-06-04T12:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 4,
    autoLifecycleEnabled: false,
  });
}

class Rollback extends Error {}

describe('the round slot migration', () => {
  it('puts a one-slot event\'s rounds all in its slot, a several-slot event\'s round n in its nth slot in play order, and deletes the rounds it cannot place', async () => {
    const prisma = getPrisma();
    const oneSlot = await eventOf('One Slot Open');
    const oneSlotSeasonSlotId = await linkTestSlot(prisma, oneSlot);
    const { id: oneSlotEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: oneSlot.id, sportLeagueSeasonCompetitionSlotId: oneSlotSeasonSlotId }, select: { id: true } });
    const bracket = await eventOf('Slot Per Round Cup');
    // Made out of play order, so the placing follows the slots' kinds, not when they were made.
    const [finalSlotId, quarterfinalSlotId, semifinalSlotId] = await eventRoundSlots(prisma, bracket.id, [{ slotKind: 'FINAL' }, { slotKind: 'QUARTERFINAL' }, { slotKind: 'SEMIFINAL' }]);
    const noSlot = await eventOf('No Slot Classic');

    const placed = await prisma.$transaction(async (tx) => {
      // The table as it was before the migration: rounds had no slot.
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_rounds" DROP CONSTRAINT "sport_event_rounds_event_slot_fkey"');
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_rounds" ALTER COLUMN "sport_event_slot_id" DROP NOT NULL');
      const rounds = [
        ...[1, 2, 3, 4].map((roundNumber) => ({ sportEventId: oneSlot.id, roundNumber })),
        ...[1, 2, 3, 4].map((roundNumber) => ({ sportEventId: bracket.id, roundNumber })),
        { sportEventId: noSlot.id, roundNumber: 1 },
      ];
      for (const round of rounds) {
        // poolmaster-allow-query-in-loop: nine fixture rounds, inserted as the old table held them
        await tx.$executeRaw`INSERT INTO "sport_event_rounds" ("id", "sport_event_id", "round_number", "scheduled_date", "updated_at")
          VALUES (${randomUUID()}::uuid, ${round.sportEventId}::uuid, ${round.roundNumber}, now(), now())`;
      }
      for (const statement of placingStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const result = await tx.sportEventRound.findMany({
        where: { sportEventId: { in: [oneSlot.id, bracket.id, noSlot.id] } },
        select: { sportEventId: true, roundNumber: true, sportEventSlotId: true },
        orderBy: [{ sportEventId: 'asc' }, { roundNumber: 'asc' }],
      });
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as { sportEventId: string; roundNumber: number; sportEventSlotId: string }[];
      throw error;
    });

    const of = (sportEventId: string) => placed.filter((round) => round.sportEventId === sportEventId).map((round) => [round.roundNumber, round.sportEventSlotId]);
    expect(of(oneSlot.id)).toEqual([1, 2, 3, 4].map((roundNumber) => [roundNumber, oneSlotEventSlotId]));
    expect(of(bracket.id)).toEqual([[1, quarterfinalSlotId], [2, semifinalSlotId], [3, finalSlotId]]);
    expect(of(noSlot.id)).toEqual([]);
    // Rolled back: the composite key is in place again.
    await expect(prisma.sportEventRound.create({
      data: { sportEventId: noSlot.id, sportEventSlotId: oneSlotEventSlotId, roundNumber: 1, scheduledDate: noSlot.startDate },
    })).rejects.toThrow();
  });
});
