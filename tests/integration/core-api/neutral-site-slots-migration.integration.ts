/**
 * The neutral-site flag moves onto the slot definition (#2154), in real Postgres: the column is
 * put back as it was (none), a bowl game and a CFP first-round game are written as home games, the
 * migration's own statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HomeAway } from '@poolmaster/shared/domain';
import type { MatchSideWrite } from '@poolmaster/shared/db';
import {
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { fixtureSeasonId, putEventInSlot } from '../../support/event-edition';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218029400_neutral_site_slots/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** Side 1 away and side 2 at home, as the sync wrote every college football game before. */
const homeGame = (sideOne: string | null, sideTwo: string | null): MatchSideWrite[] => [
  { sideNumber: 1, sportEventParticipantId: sideOne, homeAway: HomeAway.AWAY },
  { sideNumber: 2, sportEventParticipantId: sideTwo, homeAway: HomeAway.HOME },
];

/** A one-game event of NCAA men's football in the seeded slot of this competition and key, written as a home game. Answers its match's id. */
async function homeGameIn(competitionCode: string, key: string): Promise<string> {
  const prisma = getPrisma();
  const definition = await prisma.sportLeagueCompetitionSlot.findFirstOrThrow({
    where: { key, competition: { code: competitionCode }, sportLeague: { urlSegment: 'ncaamf' } },
    select: { id: true, sportLeagueId: true },
  });
  const startDate = new Date('2027-01-01T17:00:00.000Z');
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: definition.sportLeagueId,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, definition.sportLeagueId, 2026),
    name: `Neutral Site Slots ${randomUUID().slice(0, 8)}`,
    startDate,
    status: 'SCHEDULED',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  await putEventInSlot(prisma, event.id, definition.id);
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: startDate }]);
  const matchId = randomUUID();
  await new PrismaSportEventRoundMatchRepository(getAppPrisma()).replaceBracket(event.id, [
    { id: matchId, roundNumber: 1, matchNumber: 1, sides: homeGame(null, null), isNeutralSite: false, scheduledDate: startDate, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
  ]);
  return matchId;
}

class Rollback extends Error {}

interface Migrated {
  games: Record<string, { neutral: boolean; homeAway: string[] }>;
  slots: Record<string, boolean>;
  columnDefault: string | null;
}

describe('the neutral-site slots migration', () => {
  it('marks the bowl slot neutral and not the CFP first round, makes a stored bowl game neutral with neither side home, and leaves a first-round home game as it was', async () => {
    const bowlId = await homeGameIn('BOWLS', 'BOWLS');
    const firstRoundId = await homeGameIn('CFP', 'ROUND_OF_16');

    const migrated = await getPrisma().$transaction(async (tx) => {
      // The column as it was before the migration: none, every game a home game.
      await tx.$executeRawUnsafe('ALTER TABLE "sport_league_competition_slots" DROP COLUMN "is_neutral_site"');
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const games = await tx.$queryRaw<{ matchId: string; neutral: boolean; homeAway: string }[]>`${uncachedStatement()}
        SELECT g."sport_event_round_match_id" AS "matchId", g."is_neutral_site" AS "neutral", r."home_away"::text AS "homeAway"
        FROM "sport_event_round_match_games" g
        JOIN "sport_event_round_match_game_side_results" r ON r."sport_event_round_match_game_id" = g."id"
        WHERE g."sport_event_round_match_id" IN (${bowlId}::uuid, ${firstRoundId}::uuid)
        ORDER BY r."home_away"`; // HOME, AWAY, NONE: the enum's order
      const slots = await tx.$queryRaw<{ key: string; neutral: boolean }[]>`${uncachedStatement()}
        SELECT c."code" || ' ' || s."key" AS "key", s."is_neutral_site" AS "neutral"
        FROM "sport_league_competition_slots" s
        JOIN "sport_league_competitions" c ON c."id" = s."sport_league_competition_id"
        JOIN "sport_leagues" l ON l."id" = s."sport_league_id"
        WHERE l."url_segment" = 'ncaamf' AND c."code" IN ('BOWLS', 'CFP')`;
      const [column] = await tx.$queryRaw<{ columnDefault: string | null }[]>`${uncachedStatement()}
        SELECT "column_default" AS "columnDefault" FROM information_schema.columns
        WHERE "table_name" = 'sport_league_competition_slots' AND "column_name" = 'is_neutral_site'`;
      const result: Migrated = {
        games: {},
        slots: Object.fromEntries(slots.map((slot) => [slot.key, slot.neutral])),
        columnDefault: column.columnDefault,
      };
      for (const game of games) {
        const entry = result.games[game.matchId] ?? { neutral: game.neutral, homeAway: [] };
        entry.homeAway.push(game.homeAway);
        result.games[game.matchId] = entry;
      }
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated.slots).toEqual({ 'BOWLS BOWLS': true, 'CFP ROUND_OF_16': false, 'CFP QUARTERFINAL': true, 'CFP SEMIFINAL': true, 'CFP FINAL': true });
    expect(migrated.columnDefault).toBeNull();
    expect(migrated.games).toEqual({
      [bowlId]: { neutral: true, homeAway: [HomeAway.NONE, HomeAway.NONE] },
      [firstRoundId]: { neutral: false, homeAway: [HomeAway.HOME, HomeAway.AWAY] },
    });
  });
});
