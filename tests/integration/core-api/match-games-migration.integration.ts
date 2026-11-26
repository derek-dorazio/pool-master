/**
 * Every match has its Games (#2007) in real Postgres. The migration runs on QA-shaped rows: the
 * tables are put back as they were before (no Games, the provider's game id on the match), matches
 * are inserted as the old table held them, the migration's own statements run from its file, and
 * everything is rolled back. The finding kinds it adds are left out: an enum value cannot be taken
 * off again, so they stay as the migration left them. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition, mapEventToProvider } from '../../support/event-edition';
import { linkTestSlot } from '../../support/test-slots';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218022200_match_games/migration.sql');

/** The migration's statements in order, without the enum values it adds. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith('ALTER TYPE'));
}

/** A provider-linked event in one test slot with one round, answering its id, its round's id and the round's slot. */
async function eventWithRound(name: string, notifiedAt: Date | null) {
  const prisma = getPrisma();
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(prisma)),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-20T12:00:00.000Z'),
    status: 'IN_PROGRESS',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  await mapEventToProvider(prisma, event.id, { providerId: 'balldontlie', externalId: `migrated-${randomUUID()}` });
  await prisma.sportEvent.update({ where: { id: event.id }, data: { lastProviderNotificationAt: notifiedAt } });
  const seasonSlotId = await linkTestSlot(prisma, event);
  const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: 1, scheduledDate: event.startDate }, select: { id: true } });
  return { eventId: event.id, roundId: round.id, sportEventSlotId };
}

class Rollback extends Error {}

interface MigratedGame {
  matchId: string;
  sportEventSlotId: string;
  gameNumber: number;
  scheduledDate: string | null;
  status: string;
  winnerSide: string | null;
  homeScore: number | null;
  awayScore: number | null;
  lastProviderNotificationAt: string | null;
  providerGameIds: string[];
}

describe('the match games migration', () => {
  it('gives every match its Game 1 in its round\'s slot, with the match\'s date, status, result and its event\'s last notification, and moves a linked game id to that Game\'s mapping on the event\'s provider', async () => {
    const prisma = getPrisma();
    const notifiedAt = new Date('2027-03-20T14:05:00.000Z');
    const week = await eventWithRound('Migrated Week', notifiedAt);
    const bracket = await eventWithRound('Migrated Bracket', null);
    const kickoff = new Date('2027-03-20T13:00:00.000Z');
    const gameIds = [`qa-${randomUUID()}`, `qa-${randomUUID()}`];
    // QA's rows: a final game and a scheduled one linked to provider games, and a bracket match nobody linked.
    const rows = [
      { id: randomUUID(), event: week, number: 1, gameId: gameIds[0] ?? null, status: 'COMPLETED', winner: 'HOME', home: 24, away: 17 },
      { id: randomUUID(), event: week, number: 2, gameId: gameIds[1] ?? null, status: 'SCHEDULED', winner: null, home: null, away: null },
      { id: randomUUID(), event: bracket, number: 1, gameId: null, status: 'SCHEDULED', winner: null, home: null, away: null },
    ];

    const migrated = await prisma.$transaction(async (tx) => {
      // The tables as they were before the migration.
      await tx.$executeRawUnsafe('DROP TABLE "sport_event_round_match_game_provider_mappings"');
      await tx.$executeRawUnsafe('DROP TABLE "sport_event_round_match_games"');
      await tx.$executeRawUnsafe('DROP INDEX "sport_event_round_matches_event_id_key"');
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_round_matches" ADD COLUMN "external_game_id" VARCHAR(255)');
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX "sport_event_round_matches_sport_event_id_external_game_id_key" ON "sport_event_round_matches"("sport_event_id", "external_game_id")');
      for (const row of rows) {
        // poolmaster-allow-query-in-loop: three fixture matches, inserted as the old table held them
        await tx.$executeRaw`INSERT INTO "sport_event_round_matches" ("id", "sport_event_id", "sport_event_round_id", "match_number", "external_game_id", "scheduled_date", "status", "winner_side", "home_score", "away_score", "is_neutral_site", "updated_at")
          VALUES (${row.id}::uuid, ${row.event.eventId}::uuid, ${row.event.roundId}::uuid, ${row.number}, ${row.gameId}, ${kickoff}, ${row.status}::"PrismaMatchStatus", ${row.winner}::"PrismaMatchSide", ${row.home}, ${row.away}, false, now())`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const games = await tx.sportEventRoundMatchGame.findMany({
        where: { sportEventId: { in: [week.eventId, bracket.eventId] } },
        select: {
          sportEventRoundMatchId: true, sportEventSlotId: true, gameNumber: true, scheduledDate: true, status: true, winnerSide: true, homeScore: true, awayScore: true, lastProviderNotificationAt: true,
          providerMappings: { select: { externalId: true, provider: { select: { code: true } } } },
        },
      });
      throw new Rollback(JSON.stringify(games.map((game): MigratedGame => ({
        matchId: game.sportEventRoundMatchId,
        sportEventSlotId: game.sportEventSlotId,
        gameNumber: game.gameNumber,
        scheduledDate: game.scheduledDate?.toISOString() ?? null,
        status: game.status,
        winnerSide: game.winnerSide,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        lastProviderNotificationAt: game.lastProviderNotificationAt?.toISOString() ?? null,
        providerGameIds: game.providerMappings.map((mapping) => `${mapping.provider.code}:${mapping.externalId}`),
      }))));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as MigratedGame[];
      throw error;
    });

    const byMatch = new Map(migrated.map((game) => [game.matchId, game]));
    expect(migrated).toHaveLength(3);
    expect(rows.map((row) => byMatch.get(row.id))).toEqual([
      { matchId: rows[0]?.id, sportEventSlotId: week.sportEventSlotId, gameNumber: 1, scheduledDate: kickoff.toISOString(), status: 'COMPLETED', winnerSide: 'HOME', homeScore: 24, awayScore: 17, lastProviderNotificationAt: notifiedAt.toISOString(), providerGameIds: [`BALLDONTLIE:${gameIds[0] ?? ''}`] },
      { matchId: rows[1]?.id, sportEventSlotId: week.sportEventSlotId, gameNumber: 1, scheduledDate: kickoff.toISOString(), status: 'SCHEDULED', winnerSide: null, homeScore: null, awayScore: null, lastProviderNotificationAt: notifiedAt.toISOString(), providerGameIds: [`BALLDONTLIE:${gameIds[1] ?? ''}`] },
      { matchId: rows[2]?.id, sportEventSlotId: bracket.sportEventSlotId, gameNumber: 1, scheduledDate: kickoff.toISOString(), status: 'SCHEDULED', winnerSide: null, homeScore: null, awayScore: null, lastProviderNotificationAt: null, providerGameIds: [] },
    ]);
    // Rolled back: the Games tables are back, and the old rows are gone with the transaction.
    expect(await prisma.sportEventRoundMatch.count({ where: { sportEventId: { in: [week.eventId, bracket.eventId] } } })).toBe(0);
  });
});
