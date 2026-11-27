/**
 * A race's results move onto a FIELD Game (#2008), in real Postgres: the race result table and
 * its status type are put back as they were, two races' results are written to it, the
 * migration's own statements run from its file, and everything is rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createRoundRows } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { participantLeagueId } from '../../support/participant-league';
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

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218027700_race_results_on_field_games/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/**
 * The tables as they were before the migration: the race result table, its status type, sides 1
 * and 2 only, and the mapping index the migration drops.
 */
const PUT_BACK = [
  `CREATE INDEX "participant_provider_mappings_sport_league_id_external_id_idx" ON "participant_provider_mappings"("sport_league_id", "external_id")`,
  `ALTER TABLE "sport_event_round_match_game_side_results" DROP COLUMN "position", DROP COLUMN "start_position", DROP COLUMN "status"`,
  `ALTER TYPE "GameSideStatus" RENAME TO "RaceResultStatus"`,
  `ALTER TABLE "sport_event_round_match_sides" DROP CONSTRAINT "sport_event_round_match_sides_side_number_check"`,
  `ALTER TABLE "sport_event_round_match_sides" ADD CONSTRAINT "sport_event_round_match_sides_side_number_check" CHECK ("side_number" IN (1, 2))`,
  `CREATE TABLE "sport_event_participant_race_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "sport_event_participant_id" UUID NOT NULL UNIQUE REFERENCES "sport_event_participants"("id") ON DELETE CASCADE,
    "finish_position" INTEGER,
    "start_position" INTEGER,
    "result_status" "RaceResultStatus" NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "rider_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL
  )`,
];

/** A horse race with one round and the named runners on its field. */
async function race(names: readonly string[]) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.HORSE_RACING },
    create: { sport: Sport.HORSE_RACING, ...sportRowKeys(Sport.HORSE_RACING) },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { sport: Sport.HORSE_RACING })),
      name: `Race Migration ${randomUUID().slice(0, 8)}`,
      startDate: new Date('2027-05-01T22:00:00.000Z'),
      status: 'COMPLETED',
      rounds: 1,
    },
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: event.startDate }]);
  const field: Record<string, string> = {};
  for (const name of names) {
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await participantLeagueId(prisma, sport.id), name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL' },
    });
    field[name] = (await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } })).id;
  }
  return { event, field };
}

class Rollback extends Error {}

interface MovedRace {
  matches: Array<{ roundNumber: number; matchNumber: number; status: string; gameNumber: number; gameStatus: string; completedAt: string | null }>;
  sides: Array<{ sideNumber: number; entryId: string; position: number | null; startPosition: number | null; status: string }>;
}

describe('the race results migration', () => {
  it('moves each race\'s results onto one FIELD match and Game in the event\'s first round, a side per runner numbered by place, official races completed, then drops the race result table', async () => {
    const official = await race(['Arrow', 'Bolt', 'Comet']);
    const provisional = await race(['Drift']);
    const officialAt = new Date('2027-05-01T22:30:00.000Z');
    const prisma = getPrisma();

    const moved = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the put-back statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const results = [
        { entryId: official.field['Arrow'], place: 2, start: 4, status: 'FINISHED', isOfficial: true, rider: 'J. Velez' },
        { entryId: official.field['Bolt'], place: 1, start: null, status: 'FINISHED', isOfficial: true, rider: null },
        { entryId: official.field['Comet'], place: null, start: null, status: 'DID_NOT_START', isOfficial: true, rider: null },
        { entryId: provisional.field['Drift'], place: 1, start: null, status: 'FINISHED', isOfficial: false, rider: null },
      ];
      for (const result of results) {
        // poolmaster-allow-query-in-loop: one result row each, as the old table held them
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_race_results" ("sport_event_participant_id", "finish_position", "start_position", "result_status", "is_official", "rider_name", "updated_at") VALUES (${result.entryId}::uuid, ${result.place}, ${result.start}, ${result.status}::"RaceResultStatus", ${result.isOfficial}, ${result.rider}, ${officialAt})`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const read = async (sportEventId: string): Promise<MovedRace> => ({
        matches: await tx.$queryRaw`${uncachedStatement()} SELECT r."round_number" AS "roundNumber", m."match_number" AS "matchNumber", m."status"::text AS "status", g."game_number" AS "gameNumber", g."status"::text AS "gameStatus", to_char(g."completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS "completedAt" FROM "sport_event_round_matches" m JOIN "sport_event_rounds" r ON r."id" = m."sport_event_round_id" JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = m."id" WHERE m."sport_event_id" = ${sportEventId}::uuid`,
        sides: await tx.$queryRaw`${uncachedStatement()} SELECT s."side_number" AS "sideNumber", s."sport_event_participant_id"::text AS "entryId", x."position", x."start_position" AS "startPosition", x."status"::text AS "status" FROM "sport_event_round_match_sides" s JOIN "sport_event_round_match_game_side_results" x ON x."sport_event_round_match_side_id" = s."id" WHERE s."sport_event_id" = ${sportEventId}::uuid ORDER BY s."side_number"`,
      });
      const table = await tx.$queryRaw<unknown[]>`${uncachedStatement()} SELECT 1 FROM information_schema.tables WHERE "table_name" = 'sport_event_participant_race_results'`;
      throw new Rollback(JSON.stringify({ official: await read(official.event.id), provisional: await read(provisional.event.id), tableLeft: table.length > 0 }));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as { official: MovedRace; provisional: MovedRace; tableLeft: boolean };
      throw error;
    });

    expect(moved).toEqual({
      official: {
        matches: [{ roundNumber: 1, matchNumber: 1, status: 'COMPLETED', gameNumber: 1, gameStatus: 'COMPLETED', completedAt: '2027-05-01T22:30:00' }],
        sides: [
          { sideNumber: 1, entryId: official.field['Bolt'], position: 1, startPosition: null, status: 'FINISHED' },
          { sideNumber: 2, entryId: official.field['Arrow'], position: 2, startPosition: 4, status: 'FINISHED' },
          { sideNumber: 3, entryId: official.field['Comet'], position: null, startPosition: null, status: 'DID_NOT_START' },
        ],
      },
      provisional: {
        matches: [{ roundNumber: 1, matchNumber: 1, status: 'IN_PROGRESS', gameNumber: 1, gameStatus: 'IN_PROGRESS', completedAt: null }],
        sides: [{ sideNumber: 1, entryId: provisional.field['Drift'], position: 1, startPosition: null, status: 'FINISHED' }],
      },
      tableLeft: false,
    });
  });
});
