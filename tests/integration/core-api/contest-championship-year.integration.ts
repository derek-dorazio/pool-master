/**
 * A contest's championship year (#2021) in real Postgres: the migration copies each contest's
 * Season's year onto it and moves its championship finishes into that year, and the composite key
 * refuses a contest whose year disagrees with its Season. The migration test puts the old columns
 * back, runs the migration's own statements from its file, and rolls everything back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { anySeasonId } from '../../support/contest-rows';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218031500_contest_championship_year/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The tables as they were before the migration: no contest year, the review's `year`, no closed years. */
const PUT_BACK = [
  'DROP TABLE "league_championship_years"',
  'DROP INDEX "league_year_reviews_league_id_championship_year_key"',
  'ALTER TABLE "league_year_reviews" RENAME COLUMN "championship_year" TO "year"',
  'CREATE UNIQUE INDEX "league_year_reviews_league_id_year_key" ON "league_year_reviews"("league_id", "year")',
  'ALTER TABLE "contests" DROP CONSTRAINT "contests_season_year_fkey"',
  'ALTER TABLE "contests" ADD CONSTRAINT "contests_sport_league_season_id_fkey" FOREIGN KEY ("sport_league_season_id") REFERENCES "sport_league_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'DROP INDEX "sport_league_seasons_id_championship_year_key"',
  'ALTER TABLE "contests" DROP COLUMN "championship_year"',
];

class Rollback extends Error {}

/** A league with one squad and a COMPLETED contest in a Season of `championshipYear`. */
async function completedContest(championshipYear: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Year', lastName: `Keeper${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Year Cup', leagueCode: `CYR${suffix.toUpperCase()}`, name: `Year League ${suffix}` } });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, name: `Eagles ${suffix}`, createdBy: commissioner.user.id } });
  const sportLeagueSeasonId = await anySeasonId(prisma, championshipYear);
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, sportLeagueSeasonId, championshipYear, name: `Playoffs ${suffix}`, status: 'COMPLETED', selectionType: 'TIERED' },
  });
  return { league, squad, contest, sportLeagueSeasonId };
}

describe('a contest\'s championship year (#2021)', () => {
  it('copies each contest\'s Season year onto it, and moves a finish settled in the next calendar year back into the contest\'s championship year', async () => {
    const { league, squad, contest } = await completedContest(2025);
    const prisma = getPrisma();
    // Settled with the Super Bowl in February 2026, so the old write put it in 2026.
    const settledAt = new Date('2026-02-09T04:30:00.000Z');
    await prisma.leagueYearFinish.create({
      data: { leagueId: league.id, year: 2026, squadId: squad.id, contestId: contest.id, place: 1, tiedCount: 1, rankedEntryCount: 4, weight: 'NORMAL', points: 1000, settledAt },
    });

    const after = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the statements putting the old tables back, in order
        await tx.$executeRawUnsafe(statement);
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const [row] = await tx.$queryRawUnsafe<{ contestYear: number; finishYear: number }[]>(
        'SELECT c."championship_year" AS "contestYear", f."year" AS "finishYear" FROM "contests" c JOIN "league_year_finishes" f ON f."contest_id" = c."id" WHERE c."id" = $1::uuid',
        contest.id,
      );
      throw new Rollback(JSON.stringify(row));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as { contestYear: number; finishYear: number };
      throw error;
    });

    expect(after).toEqual({ contestYear: 2025, finishYear: 2025 });
  });

  it('refuses a contest whose championship year disagrees with its Season\'s, so the two can never drift apart', async () => {
    const { league, sportLeagueSeasonId } = await completedContest(2025);

    await expect(getPrisma().contest.create({
      data: { leagueId: league.id, sportLeagueSeasonId, championshipYear: 2026, name: 'Drifted', status: 'DRAFT', selectionType: 'TIERED' },
    })).rejects.toThrow(/contests_season_year_fkey/);
  });
});
