/**
 * Event-level POSTPONED and its follow job go (#2013): postponement is a Game's. In real Postgres,
 * the two enum types are put back as they were before, an event is set POSTPONED and a follow job
 * queued, the migration's own statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BackgroundJobType, JobTrigger, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
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

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218032700_drop_event_postponed/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** An enum type put back with one more value, as it was before the migration. */
function putBackEnum(type: string, table: string, column: string, extraValue: string, hasDefault: boolean): string[] {
  return [
    ...(hasDefault ? [`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`] : []),
    // Today's values, in their order, and the one the migration drops.
    `DO $$ BEGIN EXECUTE 'CREATE TYPE "${type}_put" AS ENUM (' || (SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = '"${type}"'::regtype) || ', ''${extraValue}'')'; END $$`,
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${type}_put" USING ("${column}"::text::"${type}_put")`,
    `DROP TYPE "${type}"`,
    `ALTER TYPE "${type}_put" RENAME TO "${type}"`,
    ...(hasDefault ? [`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT 'SCHEDULED'`] : []),
  ];
}

const PUT_BACK = [
  ...putBackEnum('PrismaSportEventStatus', 'sport_events', 'status', 'POSTPONED', true),
  ...putBackEnum('PrismaBackgroundJobType', 'background_jobs', 'type', 'FOLLOW_POSTPONED_EVENT_CONTESTS', false),
];

class Rollback extends Error {}

interface Migrated {
  postponed: string;
  scheduled: string;
  followJobLeft: boolean;
  activateJobLeft: boolean;
}

/** A postponed and a scheduled event, a follow job and an activate job, migrated and rolled back. */
async function migrate(): Promise<Migrated> {
  const prisma = getPrisma();
  const events = new PrismaSportEventRepository(getAppPrisma());
  const event = async (name: string) => createSportEventRow(events, {
    ...(await freshEventEdition(prisma)),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-10-10T17:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
    autoLifecycleEnabled: true,
  });
  const postponed = await event('Postponed Week');
  const scheduled = await event('Scheduled Week');
  const job = (sportEventId: string) => prisma.backgroundJob.create({
    data: { type: BackgroundJobType.ACTIVATE_EVENT_CONTESTS, trigger: JobTrigger.SYSTEM, payload: { sportEventId }, sportEventId },
  });
  const follow = await job(postponed.id);
  const activate = await job(scheduled.id);

  return prisma.$transaction(async (tx) => {
    for (const statement of PUT_BACK) {
      // poolmaster-allow-query-in-loop: the statements putting the old enum types back, in order
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_events" SET "status" = 'POSTPONED'::"PrismaSportEventStatus" WHERE "id" = ${postponed.id}::uuid`;
    await tx.$executeRaw`${uncachedStatement()} UPDATE "background_jobs" SET "type" = 'FOLLOW_POSTPONED_EVENT_CONTESTS'::"PrismaBackgroundJobType" WHERE "id" = ${follow.id}::uuid`;
    for (const statement of migrationStatements()) {
      // poolmaster-allow-query-in-loop: the migration's own statements, in order
      await tx.$executeRawUnsafe(statement);
    }
    const statuses = await tx.$queryRaw<{ id: string; status: string }[]>`${uncachedStatement()} SELECT "id", "status"::text AS "status" FROM "sport_events" WHERE "id" IN (${postponed.id}::uuid, ${scheduled.id}::uuid)`;
    const jobs = await tx.$queryRaw<{ id: string }[]>`${uncachedStatement()} SELECT "id" FROM "background_jobs" WHERE "id" IN (${follow.id}::uuid, ${activate.id}::uuid)`;
    const statusOf = (id: string) => statuses.find((row) => row.id === id)?.status ?? 'missing';
    const result: Migrated = {
      postponed: statusOf(postponed.id),
      scheduled: statusOf(scheduled.id),
      followJobLeft: jobs.some((row) => row.id === follow.id),
      activateJobLeft: jobs.some((row) => row.id === activate.id),
    };
    throw new Rollback(JSON.stringify(result));
  }, { timeout: 30_000 }).catch((error: unknown) => {
    if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
    throw error;
  });
}

describe('the drop event POSTPONED migration', () => {
  it('moves a postponed event back to SCHEDULED, leaves a scheduled one alone, and deletes the follow job while keeping every other job', async () => {
    expect(await migrate()).toEqual({
      postponed: SportEventStatus.SCHEDULED,
      scheduled: SportEventStatus.SCHEDULED,
      followJobLeft: false,
      activateJobLeft: true,
    });
  });
});
