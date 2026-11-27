/**
 * Every match has its two sides, and every Game each side's result (#2046), in real Postgres. The
 * migration runs on QA-shaped rows: the tables are put back as they were before (home and away
 * columns on the match, a winner and scores on the match and its Games, period scores as running
 * totals in their own table, a game pick naming its team), matches are inserted as the old tables
 * held them, the migration's own statements run from its file, and everything is rolled back.
 * No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaSportEventParticipantRepository, PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, createTestUser, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { expectDefined } from '../../support/expect-defined';
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

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218022500_match_sides/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The schema as it was before the migration, for the tables it changes. */
const PUT_BACK = [
  // Game picks named their team.
  'ALTER TABLE "contest_entry_match_predictions" DROP CONSTRAINT "contest_entry_match_predictions_side_fkey", DROP CONSTRAINT "contest_entry_match_predictions_side_with_team_result"',
  'DROP INDEX "contest_entry_match_predictions_sport_event_round_match_id__idx"',
  'ALTER TABLE "contest_entry_match_predictions" DROP COLUMN "sport_event_round_match_side_id"',
  'CREATE INDEX "contest_entry_match_predictions_sport_event_round_match_id_idx" ON "contest_entry_match_predictions"("sport_event_round_match_id")',
  // No side rows, no side results, and the keys they hang on.
  'DROP TABLE "sport_event_round_match_game_side_result_period_scores"',
  'DROP TABLE "sport_event_round_match_game_side_results"',
  'DROP TABLE "sport_event_round_match_sides"',
  // A slot's valuations name their field row by this key (#2044), a later migration's.
  'ALTER TABLE "sport_event_slot_participant_valuations" DROP CONSTRAINT "sport_event_slot_valuations_field_row_fkey"',
  'DROP INDEX "sport_event_participants_event_id_key"',
  'DROP INDEX "sport_event_round_match_games_match_id_key"',
  'DROP TYPE "PrismaMatchSideOutcome"',
  'DROP TYPE "PrismaHomeAway"',
  'DROP TYPE "PrismaPeriodKind"',
  'CREATE TYPE "PrismaMatchSide" AS ENUM (\'HOME\', \'AWAY\')',
  'CREATE TYPE "PrismaMatchResultSource" AS ENUM (\'PROVIDER\')',
  // The match's home and away columns, its result, where its winner goes by side name, and where
  // it was played, which a later migration (#2047) moved onto its Games.
  'ALTER TABLE "sport_event_round_matches" DROP CONSTRAINT "sport_event_round_matches_advances_to_side_number_check", DROP CONSTRAINT "sport_event_round_matches_ending_check"',
  'DROP INDEX "sport_event_round_matches_advances_to_match_id_advances_to__key"',
  `ALTER TABLE "sport_event_round_matches" DROP COLUMN "advances_to_side_number",
    ADD COLUMN "advances_to_side" "PrismaMatchSide", ADD COLUMN "home_sport_event_participant_id" UUID, ADD COLUMN "away_sport_event_participant_id" UUID,
    ADD COLUMN "winner_side" "PrismaMatchSide", ADD COLUMN "home_score" INTEGER, ADD COLUMN "away_score" INTEGER,
    ADD COLUMN "home_shootout_score" INTEGER, ADD COLUMN "away_shootout_score" INTEGER, ADD COLUMN "home_spread" DECIMAL(4,1),
    ADD COLUMN "result_source" "PrismaMatchResultSource",
    ADD COLUMN "is_neutral_site" BOOLEAN NOT NULL DEFAULT false`,
  'ALTER TABLE "sport_event_round_matches" ADD CONSTRAINT "sport_event_round_matches_home_sport_event_participant_id_fkey" FOREIGN KEY ("home_sport_event_participant_id") REFERENCES "sport_event_participants"("id")',
  'ALTER TABLE "sport_event_round_matches" ADD CONSTRAINT "sport_event_round_matches_away_sport_event_participant_id_fkey" FOREIGN KEY ("away_sport_event_participant_id") REFERENCES "sport_event_participants"("id")',
  'CREATE INDEX "sport_event_round_matches_home_sport_event_participant_id_idx" ON "sport_event_round_matches"("home_sport_event_participant_id")',
  'CREATE INDEX "sport_event_round_matches_away_sport_event_participant_id_idx" ON "sport_event_round_matches"("away_sport_event_participant_id")',
  'CREATE UNIQUE INDEX "sport_event_round_matches_advances_to_match_id_advances_to__key" ON "sport_event_round_matches"("advances_to_match_id", "advances_to_side")',
  // A Game held its score as home and away.
  'ALTER TABLE "sport_event_round_match_games" ADD COLUMN "winner_side" "PrismaMatchSide", ADD COLUMN "home_score" INTEGER, ADD COLUMN "away_score" INTEGER',
  // Period scores were the running score at the end of each period, one table per match.
  `CREATE TABLE "sport_event_match_period_scores" ("id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, "sport_event_round_match_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL, "home_score" INTEGER NOT NULL, "away_score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL)`,
];

/** One match as the old tables held it, with its Game 1. */
interface OldMatch {
  id: string;
  number: number;
  home: string | null;
  away: string | null;
  neutral: boolean;
  status: 'SCHEDULED' | 'COMPLETED';
  winner: 'HOME' | 'AWAY' | null;
  homeScore: number | null;
  awayScore: number | null;
  shootout?: { home: number; away: number };
  homeSpread?: number;
  advancesTo?: { id: string; side: 'HOME' | 'AWAY' };
  /** Running home and away scores at the end of each period but the last. */
  runningPeriods?: readonly (readonly [number, number])[];
}

/** One game pick as the old table held it. */
interface OldPick {
  matchId: string;
  result: 'TEAM' | 'TIE';
  team: string | null;
}

class Rollback extends Error {}

/** A provider-linked basketball event in one test slot with one round, its four teams in the field. */
async function eventWithField() {
  const prisma = getPrisma();
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(prisma)),
    name: `Migrated Sides ${randomUUID().slice(0, 8)}`,
    startDate: new Date('2027-03-20T12:00:00.000Z'),
    status: 'IN_PROGRESS',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  const seasonSlotId = await linkTestSlot(prisma, event);
  const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: 1, scheduledDate: event.startDate }, select: { id: true } });
  const teams = await Promise.all(['Duke', 'Houston', 'Auburn', 'Florida', 'Kansas'].map((name) => prisma.participant.create({
    data: { sportLeagueId: event.sportLeagueId, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' },
  })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team) => ({ participantId: team.id })));
  const rows = await field.findBySportEvent(event.id);
  const [duke, houston, auburn, florida, kansas] = teams.map((team) => expectDefined(rows.find((row) => row.participantId === team.id)).id);
  return { eventId: event.id, roundId: round.id, sportEventSlotId, sportLeagueId: event.sportLeagueId, team: { duke, houston, auburn, florida, kansas } };
}

/** A league's pick'em contest on the event with one entry, for its picks. */
async function pickEmEntry(sportEventId: string) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Migrated Picker ${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `MSIDE${suffix.toUpperCase()}`, name: `Migrated Sides ${suffix}` } });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Pickers ${suffix}` } });
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, seasonYear: 2027, sportEvents: { create: { sportEventId, sequence: 1 } }, name: `Picks ${suffix}`, status: 'OPEN', contestFormat: 'PREDICTION', selectionType: 'PICK_EM' },
  });
  return prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Pickers' } });
}

/** What the migration leaves, read through the client, which knows the new tables. */
function readMigrated(tx: Prisma.TransactionClient, sportEventId: string, contestEntryId: string) {
  return Promise.all([
    tx.sportEventRoundMatch.findMany({
      where: { sportEventId },
      orderBy: { matchNumber: 'asc' },
      select: {
        id: true,
        advancesToMatchId: true,
        advancesToSideNumber: true,
        sides: { orderBy: { sideNumber: 'asc' }, select: { id: true, sideNumber: true, sportEventParticipantId: true, spread: true, outcome: true } },
        games: {
          select: {
            gameNumber: true,
            sideResults: {
              orderBy: { side: { sideNumber: 'asc' } },
              select: {
                score: true,
                homeAway: true,
                side: { select: { sideNumber: true } },
                periodScores: { orderBy: [{ kind: 'asc' }, { periodNumber: 'asc' }], select: { kind: true, periodNumber: true, score: true } },
              },
            },
          },
        },
      },
    }),
    tx.contestEntryMatchPrediction.findMany({ where: { contestEntryId }, select: { sportEventRoundMatchId: true, predictedResult: true, sportEventParticipantId: true, sportEventRoundMatchSideId: true } }),
  ]);
}

/** Puts the tables back as they were, inserts the old rows, runs the migration and answers what it left, all rolled back. */
async function migrate(event: Awaited<ReturnType<typeof eventWithField>>, matches: readonly OldMatch[], contestEntryId: string, picks: readonly OldPick[]) {
  return getPrisma().$transaction(async (tx) => {
    for (const statement of PUT_BACK) {
      // poolmaster-allow-query-in-loop: the statements putting the old tables back, in order
      await tx.$executeRawUnsafe(statement);
    }
    // Feeders point at later matches, so the matches go in before any link.
    for (const match of matches) {
      // poolmaster-allow-query-in-loop: a few fixture matches, inserted as the old table held them
      await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_round_matches" ("id", "sport_event_id", "sport_event_round_id", "match_number", "is_neutral_site", "status", "home_sport_event_participant_id", "away_sport_event_participant_id", "winner_side", "home_score", "away_score", "home_shootout_score", "away_shootout_score", "home_spread", "updated_at")
        VALUES (${match.id}::uuid, ${event.eventId}::uuid, ${event.roundId}::uuid, ${match.number}, ${match.neutral}, ${match.status}::"PrismaMatchStatus", ${match.home}::uuid, ${match.away}::uuid, ${match.winner}::"PrismaMatchSide", ${match.homeScore}, ${match.awayScore}, ${match.shootout?.home ?? null}, ${match.shootout?.away ?? null}, ${match.homeSpread ?? null}, now())`;
      await tx.$executeRaw`${uncachedStatement()} INSERT INTO "sport_event_round_match_games" ("sport_event_id", "sport_event_round_match_id", "sport_event_slot_id", "game_number", "status", "winner_side", "home_score", "away_score", "updated_at")
        VALUES (${event.eventId}::uuid, ${match.id}::uuid, ${event.sportEventSlotId}::uuid, 1, ${match.status}::"PrismaMatchStatus", ${match.winner}::"PrismaMatchSide", ${match.homeScore}, ${match.awayScore}, now())`;
      for (const [index, [home, away]] of (match.runningPeriods ?? []).entries()) {
        // poolmaster-allow-query-in-loop: a fixture match's few periods
        await tx.$executeRaw`INSERT INTO "sport_event_match_period_scores" ("sport_event_round_match_id", "period_number", "home_score", "away_score", "updated_at") VALUES (${match.id}::uuid, ${index + 1}, ${home}, ${away}, now())`;
      }
    }
    for (const match of matches.filter((each) => each.advancesTo !== undefined)) {
      // poolmaster-allow-query-in-loop: a few fixture links
      await tx.$executeRaw`UPDATE "sport_event_round_matches" SET "advances_to_match_id" = ${match.advancesTo?.id ?? null}::uuid, "advances_to_side" = ${match.advancesTo?.side ?? null}::"PrismaMatchSide" WHERE "id" = ${match.id}::uuid`;
    }
    for (const pick of picks) {
      // poolmaster-allow-query-in-loop: a few fixture picks
      await tx.$executeRaw`INSERT INTO "contest_entry_match_predictions" ("contest_entry_id", "sport_event_round_match_id", "predicted_result", "sport_event_participant_id", "picked_at", "updated_at")
        VALUES (${contestEntryId}::uuid, ${pick.matchId}::uuid, ${pick.result}::"PrismaPredictedResult", ${pick.team}::uuid, now(), now())`;
    }
    for (const statement of migrationStatements()) {
      // poolmaster-allow-query-in-loop: the migration's own statements, in order
      await tx.$executeRawUnsafe(statement);
    }
    throw new Rollback(JSON.stringify(await readMigrated(tx, event.eventId, contestEntryId)));
  }, { timeout: 30_000 }).catch((error: unknown) => {
    if (error instanceof Rollback) return JSON.parse(error.message) as Awaited<ReturnType<typeof readMigrated>>;
    throw error;
  });
}

describe('the match sides migration', () => {
  it('puts each match\'s away team on side 1 and its home team on side 2, with each side\'s outcome, the spread on side 1 and where its winner goes by side number', async () => {
    const event = await eventWithField();
    const entry = await pickEmEntry(event.eventId);
    const { duke, houston, auburn, florida } = event.team;
    const final = randomUUID();
    const matches: OldMatch[] = [
      // Duke home, won 24-17 favoured by 3.5, its winner the final's home team.
      { id: randomUUID(), number: 1, home: duke, away: houston, neutral: false, status: 'COMPLETED', winner: 'HOME', homeScore: 24, awayScore: 17, homeSpread: -3.5, advancesTo: { id: final, side: 'HOME' } },
      // A level game Florida won away, its winner the final's away team.
      { id: randomUUID(), number: 2, home: auburn, away: florida, neutral: true, status: 'COMPLETED', winner: 'AWAY', homeScore: 1, awayScore: 1, shootout: { home: 2, away: 4 }, advancesTo: { id: final, side: 'AWAY' } },
      { id: final, number: 3, home: null, away: null, neutral: true, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null },
      // A draw: COMPLETED with no winner.
      { id: randomUUID(), number: 4, home: houston, away: duke, neutral: false, status: 'COMPLETED', winner: null, homeScore: 2, awayScore: 2 },
    ];

    const [migrated] = await migrate(event, matches, entry.id, []);

    expect(migrated.map((match) => [match.advancesToMatchId, match.advancesToSideNumber])).toEqual([[final, 2], [final, 1], [null, null], [null, null]]);
    expect(migrated.map((match) => match.sides.map((side) => [side.sideNumber, side.sportEventParticipantId, side.outcome, side.spread === null ? null : Number(side.spread)]))).toEqual([
      [[1, houston, 'LOST', 3.5], [2, duke, 'WON', null]],
      [[1, florida, 'WON', null], [2, auburn, 'LOST', null]],
      [[1, null, 'PENDING', null], [2, null, 'PENDING', null]],
      [[1, duke, 'TIED', null], [2, houston, 'TIED', null]],
    ]);
  });

  it('gives each Game each side\'s score and where it played, a shoot-out as one SHOOTOUT period each, and running period scores as each period\'s own points with the last period from the final score', async () => {
    const event = await eventWithField();
    const entry = await pickEmEntry(event.eventId);
    const { duke, houston, auburn, florida } = event.team;
    const matches: OldMatch[] = [
      // Three periods' running scores of four: the fourth is what the final score adds.
      { id: randomUUID(), number: 1, home: duke, away: houston, neutral: false, status: 'COMPLETED', winner: 'HOME', homeScore: 24, awayScore: 17, runningPeriods: [[7, 3], [14, 10], [17, 17]] },
      { id: randomUUID(), number: 2, home: auburn, away: florida, neutral: true, status: 'COMPLETED', winner: 'AWAY', homeScore: 1, awayScore: 1, shootout: { home: 2, away: 4 } },
      // Under way: its running periods move, and nothing is added for a period still to finish.
      { id: randomUUID(), number: 3, home: florida, away: auburn, neutral: false, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null, runningPeriods: [[10, 8]] },
    ];

    const [migrated] = await migrate(event, matches, entry.id, []);

    const results = migrated.map((match) => expectDefined(match.games[0]).sideResults.map((result) => ({
      side: result.side.sideNumber, score: result.score, homeAway: result.homeAway, periods: result.periodScores.map((period) => [period.kind, period.periodNumber, period.score]),
    })));
    expect(results).toEqual([
      [
        { side: 1, score: 17, homeAway: 'AWAY', periods: [['REGULAR', 1, 3], ['REGULAR', 2, 7], ['REGULAR', 3, 7], ['REGULAR', 4, 0]] },
        { side: 2, score: 24, homeAway: 'HOME', periods: [['REGULAR', 1, 7], ['REGULAR', 2, 7], ['REGULAR', 3, 3], ['REGULAR', 4, 7]] },
      ],
      [
        { side: 1, score: 1, homeAway: 'NONE', periods: [['SHOOTOUT', 1, 4]] },
        { side: 2, score: 1, homeAway: 'NONE', periods: [['SHOOTOUT', 1, 2]] },
      ],
      [
        { side: 1, score: null, homeAway: 'AWAY', periods: [['REGULAR', 1, 8]] },
        { side: 2, score: null, homeAway: 'HOME', periods: [['REGULAR', 1, 10]] },
      ],
    ]);
  });

  it('points each team pick at the side its team plays, or in a later game the side its team reaches through the games before, keeps each pick\'s team and a tie pick with no side, and drops a team pick whose team reaches neither side', async () => {
    const event = await eventWithField();
    const entry = await pickEmEntry(event.eventId);
    const { duke, houston, auburn, florida, kansas } = event.team;
    const [first, second, third, final] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const matches: OldMatch[] = [
      // The first game's winner goes to the final's away side, the second's to its home side.
      { id: first, number: 1, home: duke, away: houston, neutral: false, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null, advancesTo: { id: final, side: 'AWAY' } },
      { id: second, number: 2, home: auburn, away: florida, neutral: false, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null, advancesTo: { id: final, side: 'HOME' } },
      { id: third, number: 3, home: florida, away: auburn, neutral: false, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null },
      { id: final, number: 4, home: null, away: null, neutral: true, status: 'SCHEDULED', winner: null, homeScore: null, awayScore: null },
    ];
    const picks: OldPick[] = [
      { matchId: first, result: 'TEAM', team: duke },
      { matchId: second, result: 'TIE', team: null },
      // Kansas plays neither side of the third game: no longer a pick of it.
      { matchId: third, result: 'TEAM', team: kansas },
      // Florida reaches the final's home side through the second game, whose sides are not yet decided by results.
      { matchId: final, result: 'TEAM', team: florida },
    ];

    const [migrated, predictions] = await migrate(event, matches, entry.id, picks);

    const sideOf = (matchId: string, sideNumber: number) => expectDefined(migrated.find((match) => match.id === matchId)?.sides.find((side) => side.sideNumber === sideNumber)).id;
    expect([...predictions].sort((one, two) => one.sportEventRoundMatchId.localeCompare(two.sportEventRoundMatchId))).toEqual([
      { sportEventRoundMatchId: first, predictedResult: 'TEAM', sportEventParticipantId: duke, sportEventRoundMatchSideId: sideOf(first, 2) },
      { sportEventRoundMatchId: second, predictedResult: 'TIE', sportEventParticipantId: null, sportEventRoundMatchSideId: null },
      { sportEventRoundMatchId: final, predictedResult: 'TEAM', sportEventParticipantId: florida, sportEventRoundMatchSideId: sideOf(final, 2) },
    ].sort((one, two) => one.sportEventRoundMatchId.localeCompare(two.sportEventRoundMatchId)));
    // Rolled back: the old rows are gone with the transaction.
    expect(await getPrisma().sportEventRoundMatch.count({ where: { sportEventId: event.eventId } })).toBe(0);
  });
});
