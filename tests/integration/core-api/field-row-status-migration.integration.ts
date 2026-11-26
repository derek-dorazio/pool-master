/**
 * A field row's isActive flag and inactive reason become one status (#2184), in real Postgres.
 * The columns are put back as they were before, rows are set as the old columns held them, the
 * migration's own statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventParticipantRepository, PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { expectDefined } from '../../support/expect-defined';
import { freshEventEdition } from '../../support/event-edition';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218024100_field_row_status/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The field row columns as they were before the migration. */
const PUT_BACK = [
  'ALTER TABLE "sport_event_participants" DROP COLUMN "status"',
  'DROP TYPE "SportEventParticipantStatus"',
  'CREATE TYPE "ParticipantInactiveReason" AS ENUM (\'WITHDRAWN\', \'ELIMINATED\')',
  'ALTER TABLE "sport_event_participants" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "inactive_reason" "ParticipantInactiveReason"',
];

/** One field row as the old columns held it. */
interface OldRow {
  isActive: boolean;
  inactiveReason: 'WITHDRAWN' | 'ELIMINATED' | null;
}

class Rollback extends Error {}

/** A golf event with one field row per old row, migrated and rolled back; the statuses in the same order. */
async function migrate(oldRows: readonly OldRow[]): Promise<string[]> {
  const prisma = getPrisma();
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(prisma)),
    name: `Migrated Field ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-04-08T12:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 4,
    autoLifecycleEnabled: false,
  });
  const golfers = await Promise.all(oldRows.map((_, index) => prisma.participant.create({
    data: { sportLeagueId: event.sportLeagueId, name: `Golfer ${index} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL' },
  })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, golfers.map((golfer) => ({ participantId: golfer.id })));
  const rows = await field.findBySportEvent(event.id);
  const rowIds = golfers.map((golfer) => expectDefined(rows.find((row) => row.participantId === golfer.id)).id);

  return prisma.$transaction(async (tx) => {
    for (const statement of PUT_BACK) {
      // poolmaster-allow-query-in-loop: the statements putting the old columns back, in order
      await tx.$executeRawUnsafe(statement);
    }
    for (const [index, row] of oldRows.entries()) {
      // poolmaster-allow-query-in-loop: a few fixture rows, set as the old columns held them
      await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_event_participants" SET "is_active" = ${row.isActive}, "inactive_reason" = ${row.inactiveReason}::"ParticipantInactiveReason" WHERE "id" = ${rowIds[index]}::uuid`;
    }
    for (const statement of migrationStatements()) {
      // poolmaster-allow-query-in-loop: the migration's own statements, in order
      await tx.$executeRawUnsafe(statement);
    }
    const migrated = await tx.$queryRaw<{ id: string; status: string }[]>`${uncachedStatement()} SELECT "id", "status"::text AS "status" FROM "sport_event_participants" WHERE "sport_event_id" = ${event.id}::uuid`;
    throw new Rollback(JSON.stringify(rowIds.map((id) => expectDefined(migrated.find((row) => row.id === id)).status)));
  }, { timeout: 30_000 }).catch((error: unknown) => {
    if (error instanceof Rollback) return JSON.parse(error.message) as string[];
    throw error;
  });
}

describe('the field row status migration', () => {
  it('makes an active row ACTIVE whatever reason it held, an eliminated row ELIMINATED, and a withdrawn row or an inactive row with no reason WITHDRAWN', async () => {
    const statuses = await migrate([
      { isActive: true, inactiveReason: null },
      { isActive: true, inactiveReason: 'WITHDRAWN' },
      { isActive: false, inactiveReason: 'WITHDRAWN' },
      { isActive: false, inactiveReason: 'ELIMINATED' },
      { isActive: false, inactiveReason: null },
    ]);

    expect(statuses).toEqual(['ACTIVE', 'ACTIVE', 'WITHDRAWN', 'ELIMINATED', 'WITHDRAWN']);
  });
});
