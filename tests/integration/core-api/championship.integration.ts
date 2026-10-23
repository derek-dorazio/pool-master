/**
 * The league championship against Postgres (#863): the migration that names every league's
 * championship and backfills the finishes of contests already final, scored as the points rules
 * score them, and the queries the championship reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { CupPointsScale, CupWeight, SelectionType, cupFinishPoints } from '@poolmaster/shared/domain';
import { PrismaChampionshipRepository } from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261111100000_league_championship/migration.sql'),
  'utf8',
);

/** The migration's statements, comments stripped. No statement contains a semicolon of its own. */
const MIGRATION_STATEMENTS = MIGRATION_SQL
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

/** The tables the migration reads and references, as they stood before it, with only the columns it touches. */
const PRE_MIGRATION_TABLES = [
  `CREATE TABLE "leagues" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "cup_points_scale" "PrismaCupPointsScale" NOT NULL DEFAULT 'STANDARD', "cup_custom_points" integer[] NOT NULL DEFAULT ARRAY[]::integer[])`,
  `CREATE TABLE "squads" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  `CREATE TABLE "event_series" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  `CREATE TABLE "sport_events" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "event_series_id" uuid NOT NULL)`,
  `CREATE TABLE "contests" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "league_id" uuid NOT NULL, "name" text NOT NULL, "status" "PrismaContestStatus" NOT NULL, "selection_type" "PrismaSelectionType" NOT NULL, "cup_weight" "PrismaCupWeight" NOT NULL, "ends_at" timestamptz, "updated_at" timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE "contest_sport_events" ("contest_id" uuid NOT NULL, "sport_event_id" uuid NOT NULL, "sequence" integer NOT NULL)`,
  `CREATE TABLE "contest_entries" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "contest_id" uuid NOT NULL, "squad_id" uuid NOT NULL)`,
  `CREATE TABLE "contest_entry_standings" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "contest_id" uuid NOT NULL, "contest_entry_id" uuid NOT NULL, "position" integer)`,
];

describe('#863 migration: every league\'s championship name, and the finishes of contests already final', () => {
  it('names each championship "<league name> Cup" and writes each squad\'s best finish per final contest, scored and dated as settlement would', async () => {
    const schema = `mig863_${randomUUID().replace(/-/g, '')}`;
    const result = await getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
      for (const statement of PRE_MIGRATION_TABLES) {
        await tx.$executeRawUnsafe(statement);
      }
      const insert = async (sql: string, ...values: unknown[]) =>
        (await tx.$queryRawUnsafe<Array<{ id: string }>>(`${sql} RETURNING "id"`, ...values))[0]?.id ?? '';
      const standardLeague = await insert(`INSERT INTO "leagues" ("name") VALUES ('Derek''s Pool')`);
      const fieldLeague = await insert(`INSERT INTO "leagues" ("name", "cup_points_scale") VALUES ('Field Pool', 'FIELD_BEATEN')`);
      const squad = () => insert(`INSERT INTO "squads" DEFAULT VALUES`);
      const [eagles, birdies, bogeys] = [await squad(), await squad(), await squad()];
      const series = await insert(`INSERT INTO "event_series" DEFAULT VALUES`);
      const event = () => insert(`INSERT INTO "sport_events" ("event_series_id") VALUES ($1::uuid)`, series);
      const contest = async (leagueId: string, name: string, options: {
        status?: string; weight?: string; endsAt?: string | null; events?: number; places: Array<[squadId: string, position: number | null]>;
      }) => {
        const id = await insert(
          `INSERT INTO "contests" ("league_id", "name", "status", "selection_type", "cup_weight", "ends_at")
           VALUES ($1::uuid, $2, $3::"PrismaContestStatus", 'TIERED', $4::"PrismaCupWeight", $5::timestamptz)`,
          leagueId, name, options.status ?? 'COMPLETED', options.weight ?? 'NORMAL', options.endsAt ?? null,
        );
        for (let sequence = 1; sequence <= (options.events ?? 1); sequence++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "contest_sport_events" ("contest_id", "sport_event_id", "sequence") VALUES ($1::uuid, $2::uuid, $3)`,
            id, await event(), sequence,
          );
        }
        for (const [squadId, position] of options.places) {
          const entry = await insert(`INSERT INTO "contest_entries" ("contest_id", "squad_id") VALUES ($1::uuid, $2::uuid)`, id, squadId);
          await tx.$executeRawUnsafe(
            `INSERT INTO "contest_entry_standings" ("contest_id", "contest_entry_id", "position") VALUES ($1::uuid, $2::uuid, $3)`,
            id, entry, position,
          );
        }
        return id;
      };
      // Final at 11:30pm New York on New Year's Eve: the old year. The Eagles' second entry finishes 4th.
      const bowl = await contest(standardLeague, 'Bowl', {
        weight: 'BONUS',
        endsAt: '2027-01-01T04:30:00Z',
        places: [[eagles, 1], [birdies, 2], [bogeys, 2], [eagles, 4], [eagles, null]],
      });
      const majors = await contest(standardLeague, 'Majors', { events: 2, endsAt: '2026-06-21T23:00:00Z', places: [[bogeys, 1], [eagles, 12]] });
      await contest(standardLeague, 'Live', { status: 'ACTIVE', places: [[eagles, 1]] });
      await contest(standardLeague, 'Washout', { endsAt: '2026-05-01T00:00:00Z', places: [[eagles, null]] });
      const field = await contest(fieldLeague, 'Field', { endsAt: '2026-05-01T00:00:00Z', places: [[eagles, 1], [birdies, 2], [bogeys, 3]] });

      for (const statement of MIGRATION_STATEMENTS) {
        await tx.$executeRawUnsafe(statement);
      }

      const leagues = await tx.$queryRawUnsafe<Array<{ name: string; cup_name: string }>>(`SELECT "name", "cup_name" FROM "leagues" ORDER BY "name"`);
      const finishes = await tx.$queryRawUnsafe<Array<{
        contest_id: string; squad_id: string; year: number; place: number; tied_count: number; ranked_entry_count: number;
        event_series_id: string | null; selection_type: string; weight: string; points: number;
      }>>(
        `SELECT "contest_id"::text, "squad_id"::text, "year", "place", "tied_count", "ranked_entry_count", "event_series_id"::text,
           "selection_type"::text, "weight"::text, "points" FROM "league_year_finishes" ORDER BY "contest_id", "place", "squad_id"`,
      );
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      return { leagues, finishes, ids: { bowl, majors, field, eagles, birdies, bogeys, series } };
    });
    const { ids } = result;
    const standard = { scale: CupPointsScale.STANDARD, customPoints: [] };
    const fieldBeaten = { scale: CupPointsScale.FIELD_BEATEN, customPoints: [] };
    const row = (contestId: string) => result.finishes
      .filter((finish) => finish.contest_id === contestId)
      .map((finish) => [finish.squad_id, finish.year, finish.place, finish.tied_count, finish.ranked_entry_count, finish.event_series_id, finish.weight, finish.points]);

    expect(result.leagues).toEqual([
      { name: 'Derek\'s Pool', cup_name: 'Derek\'s Pool Cup' },
      { name: 'Field Pool', cup_name: 'Field Pool Cup' },
    ]);
    const [birdiesFirst, bogeysFirst] = [ids.birdies, ids.bogeys].sort();
    expect(row(ids.bowl)).toEqual([
      [ids.eagles, 2026, 1, 1, 4, ids.series, 'BONUS', cupFinishPoints(standard, { place: 1, tiedCount: 1, rankedEntryCount: 4 }, CupWeight.BONUS)],
      [birdiesFirst, 2026, 2, 2, 4, ids.series, 'BONUS', 1088],
      [bogeysFirst, 2026, 2, 2, 4, ids.series, 'BONUS', 1088],
    ]);
    expect(row(ids.majors)).toEqual([
      [ids.bogeys, 2026, 1, 1, 2, null, 'NORMAL', 1000],
      [ids.eagles, 2026, 12, 1, 2, null, 'NORMAL', cupFinishPoints(standard, { place: 12, tiedCount: 1, rankedEntryCount: 2 }, CupWeight.NORMAL)],
    ]);
    expect(row(ids.field).map((finish) => finish[7])).toEqual([1, 2, 3].map((place) => cupFinishPoints(fieldBeaten, { place, tiedCount: 1, rankedEntryCount: 3 }, CupWeight.NORMAL)));
    expect(result.finishes.every((finish) => finish.selection_type === SelectionType.TIERED)).toBe(true);
    expect(result.finishes).toHaveLength(8);
  });
});

/** A league with two squads and a commissioner's membership so cleanup finds it. */
async function seedLeague() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Champ', lastName: `Keeper${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Keeper Cup', leagueCode: `CHP${suffix.toUpperCase()}`, name: `Championship League ${suffix}` } });
  await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER' } });
  const squad = (name: string) => prisma.squad.create({ data: { leagueId: league.id, name: `${name} ${suffix}`, createdBy: commissioner.user.id } });
  const squads = { eagles: await squad('Eagles'), birdies: await squad('Birdies') };
  /** A contest of `events` fresh editions of the fixture tour. */
  const contest = async (name: string, options: { status?: 'OPEN' | 'ACTIVE' | 'COMPLETED' | 'DRAFT'; events?: number; cupWeight?: 'NORMAL' | 'NOT_COUNTED'; endsAt?: Date } = {}) => {
    const editions = [];
    for (let index = 0; index < (options.events ?? 1); index++) {
      const edition = await freshEventEdition(prisma, { eventYear: 2026 });
      editions.push(await prisma.sportEvent.create({
        data: {
          ...edition,
          externalId: `champ-${randomUUID()}`,
          providerId: 'integration-test',
          sport: 'GOLF',
          name: `${name} ${index} ${suffix}`,
          startDate: new Date('2026-04-09T12:00:00.000Z'),
        },
      }));
    }
    return prisma.contest.create({
      data: {
        leagueId: league.id,
        seasonYear: 2026,
        name,
        status: options.status ?? 'COMPLETED',
        cupWeight: options.cupWeight ?? 'NORMAL',
        endsAt: options.endsAt ?? null,
        selectionType: 'TIERED',
        sportEvents: { create: editions.map((event, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      },
      include: { sportEvents: { include: { sportEvent: true } } },
    });
  };
  return { league, squads, contest };
}

describe('PrismaChampionshipRepository (#863)', () => {
  it('writes a contest\'s finishes once, keeping the first when settlement writes them again, and reads them back by league and year', async () => {
    const repo = new PrismaChampionshipRepository(getPrisma());
    const { league, squads, contest } = await seedLeague();
    const masters = await contest('Masters');
    const finish = (squadId: string, place: number, year = 2026) => ({
      leagueId: league.id,
      year,
      squadId,
      contestId: masters.id,
      place,
      tiedCount: 1,
      rankedEntryCount: 2,
      eventSeriesId: null,
      selectionType: SelectionType.TIERED,
      weight: CupWeight.NORMAL,
      points: place === 1 ? 1000 : 800,
      settledAt: new Date('2026-04-12T23:00:00.000Z'),
    });

    await expect(repo.recordFinishes([finish(squads.eagles.id, 1), finish(squads.birdies.id, 2)])).resolves.toBe(2);
    await expect(repo.recordFinishes([finish(squads.eagles.id, 2)])).resolves.toBe(0);
    await expect(repo.recordFinishes([])).resolves.toBe(0);

    const rows = await repo.findByLeagueYear(league.id, 2026);
    expect(rows.map((row) => [row.squadId, row.place, row.points]).sort((left, right) => Number(left[1]) - Number(right[1]))).toEqual([
      [squads.eagles.id, 1, 1000],
      [squads.birdies.id, 2, 800],
    ]);
    await expect(repo.findByLeagueYear(league.id, 2025)).resolves.toEqual([]);
    await expect(repo.findByLeague(league.id)).resolves.toHaveLength(2);
  });

  it('reads a one-event contest\'s series and none for a contest of several events', async () => {
    const repo = new PrismaChampionshipRepository(getPrisma());
    const { contest } = await seedLeague();
    const masters = await contest('Masters');
    const majors = await contest('Majors', { events: 2 });

    await expect(repo.findSingleEventSeries(masters.id)).resolves.toBe(masters.sportEvents[0]?.sportEvent.eventSeriesId);
    await expect(repo.findSingleEventSeries(majors.id)).resolves.toBeNull();
  });

  it('reads the league\'s cup name, and counts its open and live contests that will count, not drafts, finals or NOT_COUNTED ones', async () => {
    const repo = new PrismaChampionshipRepository(getPrisma());
    const { league, contest } = await seedLeague();
    await contest('Open', { status: 'OPEN' });
    await contest('Live', { status: 'ACTIVE' });
    await contest('Draft', { status: 'DRAFT' });
    await contest('Final', { status: 'COMPLETED' });
    await contest('Fun', { status: 'ACTIVE', cupWeight: 'NOT_COUNTED' });

    await expect(repo.findCupName(league.id)).resolves.toBe('Keeper Cup');
    await expect(repo.findCupName(randomUUID())).resolves.toBeNull();
    await expect(repo.countUnfinishedContests(league.id)).resolves.toBe(2);
  });

  it('reads the completed contests that went final in a year\'s range, end exclusive, plus those named whenever they ended, each with its sports league (#837)', async () => {
    const repo = new PrismaChampionshipRepository(getPrisma());
    const { league, contest } = await seedLeague();
    const from = new Date('2026-01-01T05:00:00.000Z');
    const to = new Date('2027-01-01T05:00:00.000Z');
    const first = await contest('First', { endsAt: from });
    await contest('Next year', { endsAt: to });
    await contest('Last year', { endsAt: new Date('2026-01-01T04:59:59.000Z') });
    const undated = await contest('Undated');
    await contest('Live', { status: 'ACTIVE', endsAt: new Date('2026-06-01T00:00:00.000Z') });
    const sportLeague = await getPrisma().eventSeries.findUniqueOrThrow({
      where: { id: first.sportEvents[0]?.sportEvent.eventSeriesId ?? '' },
      select: { sportLeague: { select: { name: true } } },
    });

    const contests = await repo.findFinalContests(league.id, from, to, [undated.id]);

    expect(contests.map((row) => [row.name, row.completedAt?.toISOString() ?? null, row.sportLeagueName, row.selectionType]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([
      ['First', from.toISOString(), sportLeague.sportLeague.name, SelectionType.TIERED],
      ['Undated', null, sportLeague.sportLeague.name, SelectionType.TIERED],
    ]);
    await expect(repo.findFinalContests(randomUUID(), from, to, [undated.id])).resolves.toEqual([]);
  });
});
