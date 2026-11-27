/**
 * Golf rounds move onto FIELD Games (#2008), in real Postgres: the golf round and standing tables
 * and their status type are put back as they were, a tournament's rounds and standings are
 * written to them, the migration's own statements run from its file, and everything is rolled
 * back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PeriodUnit, Sport } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { oneEventSlotId, setEventSlotPeriods } from '../../support/test-slots';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218028600_golf_rounds_on_field_games/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The tables as they were before the migration: the round status type, the round, golf round and golf standing tables, and no new columns. */
const PUT_BACK = [
  `CREATE TYPE "PrismaParticipantRoundStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DNF', 'DSQ', 'MISSED_CUT')`,
  `ALTER TABLE "sport_event_round_match_game_side_results" DROP COLUMN "periods_completed", DROP COLUMN "score_to_par"`,
  `ALTER TABLE "sport_event_participant_standings" DROP COLUMN "score_to_par", DROP COLUMN "total"`,
  `CREATE TABLE "sport_event_participant_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "sport_event_participant_id" UUID NOT NULL REFERENCES "sport_event_participants"("id"),
    "sport_event_round_id" UUID NOT NULL REFERENCES "sport_event_rounds"("id"),
    "status" "PrismaParticipantRoundStatus" NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE "sport_event_participant_golf_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "participant_round_id" UUID NOT NULL UNIQUE REFERENCES "sport_event_participant_rounds"("id"),
    "strokes" INTEGER NOT NULL,
    "score_to_par" INTEGER NOT NULL,
    "thru" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE "sport_event_participant_golf_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "standing_id" UUID NOT NULL UNIQUE REFERENCES "sport_event_participant_standings"("id"),
    "event_score_to_par" INTEGER NOT NULL,
    "event_strokes" INTEGER NOT NULL,
    "current_round_thru" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL
  )`,
];

/** A golf tournament with two 18-hole rounds and the named golfers on its field. */
async function tournament(names: readonly string[]) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      name: `Golf Migration ${randomUUID().slice(0, 8)}`,
      startDate: new Date('2027-05-06T12:00:00.000Z'),
      status: 'IN_PROGRESS',
      rounds: 2,
    },
  });
  const sportEventSlotId = await oneEventSlotId(prisma, event.id);
  await setEventSlotPeriods(prisma, event.id, { unit: PeriodUnit.HOLE, count: 18 });
  const rounds: Record<number, string> = {};
  for (const roundNumber of [1, 2]) {
    rounds[roundNumber] = (await prisma.sportEventRound.create({
      data: { sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: new Date(Date.UTC(2027, 4, 5 + roundNumber, 12)) },
    })).id;
  }
  const field: Record<string, string> = {};
  for (const name of names) {
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await participantLeagueId(prisma, sport.id), name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL' },
    });
    field[name] = (await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } })).id;
  }
  return { event, rounds, field };
}

class Rollback extends Error {}

interface MovedRound {
  roundNumber: number;
  matchNumber: number;
  status: string;
  gameStatus: string;
  completedAt: string | null;
  sides: Array<{ sideNumber: number; entryId: string; score: number | null; scoreToPar: number | null; periodsCompleted: number | null; status: string | null }>;
}

describe('the golf rounds migration', () => {
  it('moves each round onto one FIELD match and Game with a side per golfer numbered by to-par, a round completed once every golfer finished it, the standings\' totals onto the standing, then drops the golf tables', async () => {
    const { event, rounds, field } = await tournament(['Ana', 'Ben', 'Cal']);
    const anaDone = new Date('2027-05-06T21:00:00.000Z');
    const benDone = new Date('2027-05-06T22:10:00.000Z');
    const prisma = getPrisma();

    const moved = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the put-back statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const played = [
        // Round 1 is over: Ana's finish sent no thru, and Cal withdrew on the 9th.
        { entryId: field['Ana'], round: 1, status: 'COMPLETED', completedAt: anaDone, strokes: 70, toPar: -2, thru: null },
        { entryId: field['Ben'], round: 1, status: 'COMPLETED', completedAt: benDone, strokes: 72, toPar: 0, thru: 18 },
        { entryId: field['Cal'], round: 1, status: 'DNF', completedAt: null, strokes: 40, toPar: 4, thru: 9 },
        // Round 2 is under way: Ben is on the 9th.
        { entryId: field['Ana'], round: 2, status: 'COMPLETED', completedAt: anaDone, strokes: 68, toPar: -4, thru: 18 },
        { entryId: field['Ben'], round: 2, status: 'IN_PROGRESS', completedAt: null, strokes: 33, toPar: -3, thru: 9 },
      ];
      for (const round of played) {
        const id = randomUUID();
        // poolmaster-allow-query-in-loop: one round row each, as the old tables held them
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_rounds" ("id", "sport_event_participant_id", "sport_event_round_id", "status", "completed_at", "updated_at") VALUES (${id}::uuid, ${round.entryId}::uuid, ${rounds[round.round]}::uuid, ${round.status}::"PrismaParticipantRoundStatus", ${round.completedAt}, now())`;
        // poolmaster-allow-query-in-loop: its golf row
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_golf_rounds" ("participant_round_id", "strokes", "score_to_par", "thru", "updated_at") VALUES (${id}::uuid, ${round.strokes}, ${round.toPar}, ${round.thru}, now())`;
      }
      for (const [name, toPar, strokes] of [['Ana', -6, 138], ['Ben', -3, 105]] as const) {
        const standingId = randomUUID();
        // poolmaster-allow-query-in-loop: one standing and its golf row each
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_standings" ("id", "sport_event_participant_id", "status", "updated_at") VALUES (${standingId}::uuid, ${field[name]}::uuid, 'ACTIVE', now())`;
        // poolmaster-allow-query-in-loop: its golf row
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_participant_golf_standings" ("standing_id", "event_score_to_par", "event_strokes", "current_round_thru", "updated_at") VALUES (${standingId}::uuid, ${toPar}, ${strokes}, 9, now())`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const matches = await tx.$queryRaw<Array<Omit<MovedRound, 'sides'> & { matchId: string }>>`${uncachedStatement()} SELECT m."id"::text AS "matchId", r."round_number" AS "roundNumber", m."match_number" AS "matchNumber", m."status"::text AS "status", g."status"::text AS "gameStatus", to_char(g."completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS "completedAt" FROM "sport_event_round_matches" m JOIN "sport_event_rounds" r ON r."id" = m."sport_event_round_id" JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = m."id" AND g."game_number" = 1 WHERE m."sport_event_id" = ${event.id}::uuid ORDER BY r."round_number"`;
      const sides = await tx.$queryRaw<Array<MovedRound['sides'][number] & { matchId: string }>>`${uncachedStatement()} SELECT s."sport_event_round_match_id"::text AS "matchId", s."side_number" AS "sideNumber", s."sport_event_participant_id"::text AS "entryId", x."score", x."score_to_par" AS "scoreToPar", x."periods_completed" AS "periodsCompleted", x."status"::text AS "status" FROM "sport_event_round_match_sides" s JOIN "sport_event_round_match_game_side_results" x ON x."sport_event_round_match_side_id" = s."id" WHERE s."sport_event_id" = ${event.id}::uuid ORDER BY s."side_number"`;
      const standings = await tx.$queryRaw<Array<{ entryId: string; total: number | null; scoreToPar: number | null }>>`${uncachedStatement()} SELECT "sport_event_participant_id"::text AS "entryId", "total", "score_to_par" AS "scoreToPar" FROM "sport_event_participant_standings" WHERE "sport_event_participant_id" IN (${field['Ana']}::uuid, ${field['Ben']}::uuid) ORDER BY "score_to_par"`;
      const left = await tx.$queryRaw<Array<{ name: string }>>`${uncachedStatement()} SELECT "table_name" AS "name" FROM information_schema.tables WHERE "table_name" IN ('sport_event_participant_rounds', 'sport_event_participant_golf_rounds', 'sport_event_participant_golf_standings') UNION ALL SELECT "typname" FROM pg_type WHERE "typname" = 'PrismaParticipantRoundStatus'`;
      const byRound: MovedRound[] = matches.map(({ matchId, ...match }) => ({
        ...match,
        sides: sides.filter((side) => side.matchId === matchId).map(({ matchId: _match, ...side }) => side),
      }));
      throw new Rollback(JSON.stringify({ rounds: byRound, standings, left: left.map(({ name }) => name) }));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as unknown;
      throw error;
    });

    expect(moved).toEqual({
      rounds: [
        {
          roundNumber: 1,
          matchNumber: 1,
          status: 'COMPLETED',
          gameStatus: 'COMPLETED',
          // The last of its golfers to finish.
          completedAt: '2027-05-06T22:10:00',
          sides: [
            // A finish with no thru counts every hole of the round's slot.
            { sideNumber: 1, entryId: field['Ana'], score: 70, scoreToPar: -2, periodsCompleted: 18, status: 'FINISHED' },
            { sideNumber: 2, entryId: field['Ben'], score: 72, scoreToPar: 0, periodsCompleted: 18, status: 'FINISHED' },
            { sideNumber: 3, entryId: field['Cal'], score: 40, scoreToPar: 4, periodsCompleted: 9, status: 'DID_NOT_FINISH' },
          ],
        },
        {
          roundNumber: 2,
          matchNumber: 1,
          status: 'IN_PROGRESS',
          gameStatus: 'IN_PROGRESS',
          completedAt: null,
          sides: [
            { sideNumber: 1, entryId: field['Ana'], score: 68, scoreToPar: -4, periodsCompleted: 18, status: 'FINISHED' },
            { sideNumber: 2, entryId: field['Ben'], score: 33, scoreToPar: -3, periodsCompleted: 9, status: null },
          ],
        },
      ],
      standings: [
        { entryId: field['Ana'], total: 138, scoreToPar: -6 },
        { entryId: field['Ben'], total: 105, scoreToPar: -3 },
      ],
      left: [],
    });
  });
});
