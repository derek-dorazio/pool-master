/**
 * An event's own notification time moves to its Games in progress (#2008), in real Postgres: the
 * column is put back on the event as it was, the migration's own statements run from its file,
 * and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MatchStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { linkTestSlot } from '../../support/test-slots';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218030300_event_notification_on_games/migration.sql');

function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** An event with one round and a Game of each status and notification time asked for. */
async function eventWithGames(games: ReadonlyArray<{ status: MatchStatus; notifiedAt: Date | null }>) {
  const prisma = getPrisma();
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(prisma)),
    name: `Notified ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-20T12:00:00.000Z'),
    status: 'IN_PROGRESS',
    autoLifecycleEnabled: false,
  });
  const seasonSlotId = await linkTestSlot(prisma, event);
  const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: 1, scheduledDate: event.startDate }, select: { id: true } });
  const ids: string[] = [];
  for (const [index, game] of games.entries()) {
    // poolmaster-allow-query-in-loop: a few fixture Games, each in a match of its own
    const match = await prisma.sportEventRoundMatch.create({ data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: index + 1 } });
    // poolmaster-allow-query-in-loop: a few fixture Games, each in a match of its own
    const row = await prisma.sportEventRoundMatchGame.create({
      data: { sportEventId: event.id, sportEventRoundMatchId: match.id, sportEventSlotId, gameNumber: 1, status: game.status, lastProviderNotificationAt: game.notifiedAt },
    });
    ids.push(row.id);
  }
  return { eventId: event.id, gameIds: ids };
}

class Rollback extends Error {}

/** Puts the event's column back holding `eventNotifiedAt`, runs the migration and answers each Game's notification time, all rolled back. */
async function migrate(eventId: string, eventNotifiedAt: Date): Promise<Map<string, string | null>> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "sport_events" ADD COLUMN "last_provider_notification_at" TIMESTAMPTZ');
    await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_events" SET "last_provider_notification_at" = ${eventNotifiedAt} WHERE "id" = ${eventId}::uuid`;
    for (const statement of migrationStatements()) {
      // poolmaster-allow-query-in-loop: the migration's own statements, in order
      await tx.$executeRawUnsafe(statement);
    }
    const games = await tx.sportEventRoundMatchGame.findMany({ where: { sportEventId: eventId }, select: { id: true, lastProviderNotificationAt: true } });
    throw new Rollback(JSON.stringify(games.map((game) => [game.id, game.lastProviderNotificationAt?.toISOString() ?? null])));
  }, { timeout: 30_000 }).catch((error: unknown) => {
    if (error instanceof Rollback) return new Map(JSON.parse(error.message) as Array<[string, string | null]>);
    throw error;
  });
}

describe('the event notification on Games migration', () => {
  it('moves an event\'s notification time to its Games in progress that have none or an older one, and leaves a later one, and every Game not in progress, as they were', async () => {
    const eventNotifiedAt = new Date('2027-03-20T14:00:00.000Z');
    const later = new Date('2027-03-20T14:30:00.000Z');
    const older = new Date('2027-03-20T13:00:00.000Z');
    const { eventId, gameIds } = await eventWithGames([
      { status: MatchStatus.IN_PROGRESS, notifiedAt: null },
      { status: MatchStatus.IN_PROGRESS, notifiedAt: older },
      { status: MatchStatus.IN_PROGRESS, notifiedAt: later },
      { status: MatchStatus.COMPLETED, notifiedAt: null },
      { status: MatchStatus.SCHEDULED, notifiedAt: null },
    ]);

    const migrated = await migrate(eventId, eventNotifiedAt);

    expect(gameIds.map((id) => migrated.get(id))).toEqual([
      eventNotifiedAt.toISOString(),
      eventNotifiedAt.toISOString(),
      later.toISOString(),
      null,
      null,
    ]);
  });
});
