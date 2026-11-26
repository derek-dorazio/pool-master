/**
 * Match numbers within their round (#2161) in real Postgres. The migration runs on QA-shaped rows:
 * the table is put back as it was before (one number across the event), matches are inserted with
 * event-wide numbers, the migration's own statements run from its file, and everything is rolled
 * back. Then the new key itself: two rounds may each have a match 1, one round may not have two.
 * No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { linkTestSlot } from '../../support/test-slots';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218021700_match_numbers_per_round/migration.sql');

function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** An event in one test slot with `rounds` rounds, answering the rounds' ids, round 1 first. */
async function eventWithRounds(name: string, rounds: number) {
  const prisma = getPrisma();
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(prisma)),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-20T12:00:00.000Z'),
    status: 'SCHEDULED',
    rounds,
    autoLifecycleEnabled: false,
  });
  const seasonSlotId = await linkTestSlot(prisma, event);
  const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
  const roundIds: string[] = [];
  for (let roundNumber = 1; roundNumber <= rounds; roundNumber += 1) {
    // poolmaster-allow-query-in-loop: a few fixture rounds
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: event.startDate }, select: { id: true } });
    roundIds.push(round.id);
  }
  return { eventId: event.id, roundIds };
}

class Rollback extends Error {}

interface StoredMatch { id: string; roundNumber: number; matchNumber: number; advancesToMatchId: string | null }

describe('the match numbers per round migration', () => {
  it('renumbers each round\'s matches 1, 2, 3 in the order their event-wide numbers gave, leaving every link between matches as it was', async () => {
    const prisma = getPrisma();
    const bracket = await eventWithRounds('Renumbered Cup', 3);
    const week = await eventWithRounds('Renumbered Week', 1);
    // QA's rows: a bracket numbered 1-4, 5-6 and 7 across its rounds, and a week whose numbers have gaps.
    const ids = { final: randomUUID(), semiA: randomUUID(), semiB: randomUUID(), r1: [randomUUID(), randomUUID(), randomUUID(), randomUUID()], week: [randomUUID(), randomUUID(), randomUUID()] };
    const rows: { id: string; eventId: string; roundId: string; number: number; advancesTo: string | null; side: 'HOME' | 'AWAY' | null }[] = [
      // Inserted later rounds first, so the renumbering follows the numbers, not the order the rows were written.
      { id: ids.final, eventId: bracket.eventId, roundId: bracket.roundIds[2] ?? '', number: 7, advancesTo: null, side: null },
      { id: ids.semiB, eventId: bracket.eventId, roundId: bracket.roundIds[1] ?? '', number: 6, advancesTo: ids.final, side: 'AWAY' },
      { id: ids.semiA, eventId: bracket.eventId, roundId: bracket.roundIds[1] ?? '', number: 5, advancesTo: ids.final, side: 'HOME' },
      ...[4, 3, 2, 1].map((number) => ({ id: ids.r1[number - 1] ?? '', eventId: bracket.eventId, roundId: bracket.roundIds[0] ?? '', number, advancesTo: number <= 2 ? ids.semiA : ids.semiB, side: number % 2 === 1 ? 'HOME' as const : 'AWAY' as const })),
      { id: ids.week[2] ?? '', eventId: week.eventId, roundId: week.roundIds[0] ?? '', number: 9, advancesTo: null, side: null },
      { id: ids.week[0] ?? '', eventId: week.eventId, roundId: week.roundIds[0] ?? '', number: 2, advancesTo: null, side: null },
      { id: ids.week[1] ?? '', eventId: week.eventId, roundId: week.roundIds[0] ?? '', number: 5, advancesTo: null, side: null },
    ];

    const stored = await prisma.$transaction(async (tx) => {
      // The table as it was before the migration, its event-wide key as a plain index so other suites' rows cannot clash.
      await tx.$executeRawUnsafe('DROP INDEX "sport_event_round_matches_sport_event_round_id_match_number_key"');
      await tx.$executeRawUnsafe('CREATE INDEX "sport_event_round_matches_sport_event_id_match_number_key" ON "sport_event_round_matches"("sport_event_id", "match_number")');
      await tx.$executeRawUnsafe('CREATE INDEX "sport_event_round_matches_sport_event_round_id_idx" ON "sport_event_round_matches"("sport_event_round_id")');
      for (const row of rows) {
        // poolmaster-allow-query-in-loop: ten fixture matches, inserted as the old table held them
        await tx.$executeRaw`INSERT INTO "sport_event_round_matches" ("id", "sport_event_id", "sport_event_round_id", "match_number", "advances_to_match_id", "advances_to_side", "is_neutral_site", "updated_at")
          VALUES (${row.id}::uuid, ${row.eventId}::uuid, ${row.roundId}::uuid, ${row.number}, ${row.advancesTo}::uuid, ${row.side}::"PrismaMatchSide", false, now())`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const result = await tx.sportEventRoundMatch.findMany({
        where: { sportEventId: { in: [bracket.eventId, week.eventId] } },
        select: { id: true, matchNumber: true, advancesToMatchId: true, sportEventRound: { select: { roundNumber: true } } },
      });
      throw new Rollback(JSON.stringify(result.map((match): StoredMatch => ({ id: match.id, roundNumber: match.sportEventRound.roundNumber, matchNumber: match.matchNumber, advancesToMatchId: match.advancesToMatchId }))));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as StoredMatch[];
      throw error;
    });

    const byId = new Map(stored.map((match) => [match.id, match]));
    const placeOf = (id: string) => {
      const match = byId.get(id);
      return match && [match.roundNumber, match.matchNumber];
    };
    expect(ids.r1.map(placeOf)).toEqual([[1, 1], [1, 2], [1, 3], [1, 4]]);
    expect([ids.semiA, ids.semiB, ids.final].map(placeOf)).toEqual([[2, 1], [2, 2], [3, 1]]);
    expect(ids.week.map(placeOf)).toEqual([[1, 1], [1, 2], [1, 3]]);
    expect(rows.map((row) => byId.get(row.id)?.advancesToMatchId ?? null)).toEqual(rows.map((row) => row.advancesTo));
    // Rolled back: the per-round key is in place again, so the old event-wide numbers are gone with the rows.
    expect(await prisma.sportEventRoundMatch.count({ where: { sportEventId: { in: [bracket.eventId, week.eventId] } } })).toBe(0);
  });
});

describe('a match\'s number, unique within its round', () => {
  it('keeps a match 1 in each of two rounds of one event, and refuses a second match 1 in the same round', async () => {
    const prisma = getPrisma();
    const { eventId, roundIds } = await eventWithRounds('Two Match Ones', 2);
    const [first, second] = roundIds;
    const matchOne = (sportEventRoundId: string | undefined) => prisma.sportEventRoundMatch.create({
      data: { sportEventId: eventId, sportEventRoundId: sportEventRoundId ?? '', matchNumber: 1, isNeutralSite: false },
    });

    await matchOne(first);
    await matchOne(second);

    expect(await prisma.sportEventRoundMatch.count({ where: { sportEventId: eventId, matchNumber: 1 } })).toBe(2);
    await expect(matchOne(first)).rejects.toMatchObject({ code: 'P2002' });
  });
});
