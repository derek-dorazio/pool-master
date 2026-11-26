/**
 * The neutral-site flag moves onto the Game (#2047), in real Postgres: the match's flag and
 * completion time are put back as they were, one match is marked neutral, the migration's own
 * statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HomeAway, Sport } from '@poolmaster/shared/domain';
import type { MatchSideWrite } from '@poolmaster/shared/db';
import {
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218026100_game_neutral_site/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

const sides = (sideOne: string | null, sideTwo: string | null): MatchSideWrite[] => [
  { sideNumber: 1, sportEventParticipantId: sideOne, homeAway: HomeAway.NONE },
  { sideNumber: 2, sportEventParticipantId: sideTwo, homeAway: HomeAway.NONE },
];

/** A two-match basketball event: match 1 at a neutral site, match 2 at a team's home. */
async function twoMatchEvent() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NCAA Men\'s Basketball' } },
    create: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: 'NCAA Men\'s Basketball' },
    update: {},
  });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: `Neutral Site Migration ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-18T16:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') }]);
  const neutralId = randomUUID();
  const homeId = randomUUID();
  await new PrismaSportEventRoundMatchRepository(getAppPrisma()).replaceBracket(event.id, [
    { id: neutralId, roundNumber: 1, matchNumber: 1, sides: sides(null, null), isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
    { id: homeId, roundNumber: 1, matchNumber: 2, sides: sides(null, null), isNeutralSite: false, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
  ]);
  return { event, neutralId, homeId };
}

class Rollback extends Error {}

interface Migrated {
  gameNeutralSite: Record<string, boolean>;
  matchColumns: string[];
}

describe('the neutral-site migration', () => {
  it('gives each Game its match\'s neutral-site flag, then drops the match\'s flag and completion time', async () => {
    const { event, neutralId, homeId } = await twoMatchEvent();
    const prisma = getPrisma();

    const migrated = await prisma.$transaction(async (tx) => {
      // The columns as they were before the migration: the flag and completion time on the match.
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_round_match_games" DROP COLUMN "is_neutral_site"');
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_round_matches" ADD COLUMN "is_neutral_site" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "completed_at" TIMESTAMPTZ');
      await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_event_round_matches" SET "is_neutral_site" = true WHERE "id" = ${neutralId}::uuid`;
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const games = await tx.$queryRaw<{ matchId: string; neutral: boolean }[]>`${uncachedStatement()} SELECT "sport_event_round_match_id" AS "matchId", "is_neutral_site" AS "neutral" FROM "sport_event_round_match_games" WHERE "sport_event_id" = ${event.id}::uuid`;
      const columns = await tx.$queryRaw<{ name: string }[]>`${uncachedStatement()} SELECT "column_name" AS "name" FROM information_schema.columns WHERE "table_name" = 'sport_event_round_matches' AND "column_name" IN ('is_neutral_site', 'completed_at')`;
      const result: Migrated = {
        gameNeutralSite: Object.fromEntries(games.map((game) => [game.matchId, game.neutral])),
        matchColumns: columns.map((column) => column.name),
      };
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated).toEqual({ gameNeutralSite: { [neutralId]: true, [homeId]: false }, matchColumns: [] });
  });
});
