/**
 * A squares contest names its Game, not its match (#2050), in real Postgres. The old match
 * column is put back as it was, rows are set as it held them, the migration's own statements run
 * from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { oneEventSlotId } from '../../support/test-slots';
import { createMatchRow } from '../../support/match-rows';
import { contestOnEvents } from '../../support/contest-rows';
import { squaresGameCreate } from '../../support/squares-game-row';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218030800_squares_game_and_slot_eligibility/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The squares and league columns as they were before the migration, each squares row on its Game's match. */
const PUT_BACK = [
  'ALTER TABLE "sport_leagues" ADD COLUMN "squares_from_round" INTEGER',
  'ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_squares_from_round_check CHECK (((squares_from_round IS NULL) OR (squares_from_round >= 1)))',
  'ALTER TABLE "contest_squares_games" ADD COLUMN "sport_event_round_match_id" UUID',
  'UPDATE "contest_squares_games" AS squares SET "sport_event_round_match_id" = game."sport_event_round_match_id" FROM "sport_event_round_match_games" AS game WHERE game."id" = squares."sport_event_round_match_game_id"',
  'ALTER TABLE "contest_squares_games" ALTER COLUMN "sport_event_round_match_id" SET NOT NULL',
  'ALTER TABLE "contest_squares_games" ADD CONSTRAINT "contest_squares_games_sport_event_round_match_id_fkey" FOREIGN KEY ("sport_event_round_match_id") REFERENCES "sport_event_round_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'CREATE INDEX "contest_squares_games_sport_event_round_match_id_idx" ON "contest_squares_games"("sport_event_round_match_id")',
  'ALTER TABLE "contest_squares_games" DROP COLUMN "sport_event_round_match_game_id"',
];

class Rollback extends Error {}

/** A squares contest on Game 1 of a new football game; its contest and its match and Game 1 ids. */
async function squaresContest(): Promise<{ contestId: string; matchId: string; gameOneId: string }> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const event = await prisma.sportEvent.create({
    data: { ...(await freshEventEdition(prisma, { sport: Sport.FOOTBALL })), name: `Migrated Squares ${suffix}`, startDate: new Date('2030-02-03T23:30:00.000Z'), status: 'SCHEDULED' },
  });
  const round = await prisma.sportEventRound.create({
    data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: event.startDate },
  });
  const match = await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: round.id, sportEventSlotId: round.sportEventSlotId, matchNumber: 1, teams: [null, null], isNeutralSite: false });
  const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `MSQ${suffix.toUpperCase()}`, name: `Migrated Squares ${suffix}`, iconKey: 'TROPHY' } });
  const squaresGame = await squaresGameCreate(prisma, match.id);
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, ...(await contestOnEvents(prisma, [event.id])), squaresGame, name: `Migrated Squares ${suffix}`, status: 'DRAFT', contestFormat: 'SQUARES', selectionType: 'SQUARES' },
  });
  return { contestId: contest.id, matchId: match.id, gameOneId: squaresGame.create.sportEventRoundMatchGameId };
}

describe('the squares Game migration', () => {
  it('moves each squares contest to its match\'s Game 1, and drops a squares row whose match has no Game 1, which cannot be played', async () => {
    const played = await squaresContest();
    const broken = await squaresContest();
    const prisma = getPrisma();

    const games = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the statements putting the old columns back, in order
        await tx.$executeRawUnsafe(statement);
      }
      // A match left without its Game 1, as no match is now: its squares row has no Game to move to.
      await tx.$executeRaw`${uncachedStatement()} DELETE FROM "sport_event_round_match_games" WHERE "sport_event_round_match_id" = ${broken.matchId}::uuid`;
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const rows = await tx.$queryRaw<{ contestId: string; gameId: string }[]>`${uncachedStatement()} SELECT "contest_id"::text AS "contestId", "sport_event_round_match_game_id"::text AS "gameId" FROM "contest_squares_games" WHERE "contest_id" IN (${played.contestId}::uuid, ${broken.contestId}::uuid)`;
      throw new Rollback(JSON.stringify(rows));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as { contestId: string; gameId: string }[];
      throw error;
    });

    expect(games).toEqual([{ contestId: played.contestId, gameId: played.gameOneId }]);
  });
});
