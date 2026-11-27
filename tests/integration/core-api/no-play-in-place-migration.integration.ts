/**
 * The play-in place leaves the field (#2184), in real Postgres: the column is put back as it was,
 * one row is marked a place, the migration's own statements run from its file, and everything is
 * rolled back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HomeAway, Sport } from '@poolmaster/shared/domain';
import type { MatchSideWrite } from '@poolmaster/shared/db';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { expectDefined } from '../../support/expect-defined';
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

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218025400_no_play_in_place/migration.sql');

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

/** A one-match basketball event whose away side is the play-in place "Texas / Xavier". */
async function eventWithPlayInPlace() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, ...sportRowKeys(Sport.BASKETBALL) },
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
    name: `Play-in Migration ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-18T16:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') }]);
  const [duke, pairing] = await Promise.all(['Duke', 'Texas / Xavier'].map((name) => prisma.participant.create({
    data: { sportLeagueId: sportLeague.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' },
  })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, [{ participantId: duke.id, seedNumber: 1 }, { participantId: pairing.id, seedNumber: 16 }]);
  const rows = await field.findBySportEvent(event.id);
  const rowOf = (participantId: string) => expectDefined(rows.find((row) => row.participantId === participantId)).id;
  await new PrismaSportEventRoundMatchRepository(getAppPrisma()).replaceBracket(event.id, [{
    id: randomUUID(), roundNumber: 1, matchNumber: 1, sides: sides(rowOf(duke.id), rowOf(pairing.id)), isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null,
  }]);
  return { event, duke, pairing, dukeRow: rowOf(duke.id), placeRow: rowOf(pairing.id) };
}

class Rollback extends Error {}

interface Migrated {
  fieldRows: string[];
  sides: (string | null)[];
  participantStatuses: Record<string, string>;
}

describe('the play-in place migration', () => {
  it('empties the side a play-in place held, deletes the place\'s field row, inactivates the pairing\'s participant and leaves every other row as it was', async () => {
    const { event, duke, pairing, dukeRow, placeRow } = await eventWithPlayInPlace();
    const prisma = getPrisma();

    const migrated = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "sport_event_participants" ADD COLUMN "is_play_in_place" BOOLEAN NOT NULL DEFAULT false');
      await tx.$executeRaw`${uncachedStatement()} UPDATE "sport_event_participants" SET "is_play_in_place" = true WHERE "id" = ${placeRow}::uuid`;
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const fieldRows = await tx.$queryRaw<{ id: string }[]>`${uncachedStatement()} SELECT "id" FROM "sport_event_participants" WHERE "sport_event_id" = ${event.id}::uuid`;
      const matchSides = await tx.$queryRaw<{ id: string | null }[]>`${uncachedStatement()} SELECT s."sport_event_participant_id" AS "id" FROM "sport_event_round_match_sides" s JOIN "sport_event_round_matches" m ON m."id" = s."sport_event_round_match_id" WHERE m."sport_event_id" = ${event.id}::uuid ORDER BY s."side_number"`;
      const participants = await tx.$queryRaw<{ id: string; status: string }[]>`${uncachedStatement()} SELECT "id", "status"::text AS "status" FROM "participants" WHERE "id" IN (${duke.id}::uuid, ${pairing.id}::uuid)`;
      const result: Migrated = {
        fieldRows: fieldRows.map((row) => row.id),
        sides: matchSides.map((side) => side.id),
        participantStatuses: Object.fromEntries(participants.map((row) => [row.id, row.status])),
      };
      throw new Rollback(JSON.stringify(result));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as Migrated;
      throw error;
    });

    expect(migrated).toEqual({
      fieldRows: [dukeRow],
      sides: [dukeRow, null],
      participantStatuses: { [duke.id]: 'ACTIVE', [pairing.id]: 'INACTIVE' },
    });
  });
});
