/**
 * Cups against Postgres (#841): the migration that gives every contest its season and every
 * league its cups, and the queries cup standings are worked out from.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { CupPointsScale, CupStatus, CupTrophy, CupWeight } from '@poolmaster/shared/domain';
import { PrismaCupRepository } from '../../../packages/core-api/src/adapters';
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
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261110100000_cups/migration.sql'),
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

/** The tables the migration reads and alters, as they stood before it, with only the columns it touches. */
const PRE_MIGRATION_TABLES = [
  `CREATE TABLE "leagues" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  `CREATE TABLE "sport_leagues" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  `CREATE TABLE "event_series" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "sport_league_id" uuid NOT NULL)`,
  `CREATE TABLE "sport_events" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "event_series_id" uuid NOT NULL, "event_year" integer NOT NULL)`,
  `CREATE TABLE "contests" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "league_id" uuid NOT NULL, "name" text NOT NULL, "created_at" timestamptz NOT NULL)`,
  `CREATE TABLE "contest_sport_events" ("contest_id" uuid NOT NULL, "sport_event_id" uuid NOT NULL, "sequence" integer NOT NULL)`,
];

describe('#841 migration: every contest gets its season, every league its cups', () => {
  it('gives each contest its first event\'s year, a contest with no event its creation year, and each league one cup per season and sports league', async () => {
    const schema = `mig841_${randomUUID().replace(/-/g, '')}`;
    const result = await getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
      for (const statement of PRE_MIGRATION_TABLES) {
        await tx.$executeRawUnsafe(statement);
      }
      const insert = async (sql: string, ...values: unknown[]) =>
        (await tx.$queryRawUnsafe<Array<{ id: string }>>(`${sql} RETURNING "id"`, ...values))[0]?.id ?? '';
      const league = await insert(`INSERT INTO "leagues" DEFAULT VALUES`);
      const pga = await insert(`INSERT INTO "sport_leagues" DEFAULT VALUES`);
      const nfl = await insert(`INSERT INTO "sport_leagues" DEFAULT VALUES`);
      const event = async (sportLeagueId: string, year: number) => insert(
        `INSERT INTO "sport_events" ("event_series_id", "event_year") VALUES ($1::uuid, $2)`,
        await insert(`INSERT INTO "event_series" ("sport_league_id") VALUES ($1::uuid)`, sportLeagueId),
        year,
      );
      const contest = async (name: string, eventIds: string[]) => {
        const id = await insert(
          `INSERT INTO "contests" ("league_id", "name", "created_at") VALUES ($1::uuid, $2, '2024-06-01T00:00:00Z')`,
          league, name,
        );
        for (const [index, eventId] of eventIds.entries()) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "contest_sport_events" ("contest_id", "sport_event_id", "sequence") VALUES ($1::uuid, $2::uuid, $3)`,
            id, eventId, index + 1,
          );
        }
      };
      const masters = await event(pga, 2026);
      const open = await event(pga, 2026);
      // A pick'em season's January weeks are the 2025 season's editions.
      const week1 = await event(nfl, 2025);
      const week18 = await event(nfl, 2025);
      await contest('Masters pool', [masters]);
      await contest('Majors pool', [masters, open]);
      await contest('NFL season', [week1, week18]);
      await contest('No events', []);

      for (const statement of MIGRATION_STATEMENTS) {
        await tx.$executeRawUnsafe(statement);
      }

      const contests = await tx.$queryRawUnsafe<Array<{ name: string; season_year: number; cup_weight: string }>>(
        `SELECT "name", "season_year", "cup_weight"::text AS "cup_weight" FROM "contests" ORDER BY "name"`,
      );
      const cups = await tx.$queryRawUnsafe<Array<{ season_year: number; sport_league_id: string }>>(
        `SELECT "season_year", "sport_league_id"::text AS "sport_league_id" FROM "cups" ORDER BY "season_year"`,
      );
      const [scale] = await tx.$queryRawUnsafe<Array<{ cup_points_scale: string }>>(
        `SELECT "cup_points_scale"::text AS "cup_points_scale" FROM "leagues"`,
      );
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      return { contests, cups, scale, pga, nfl };
    });

    expect(result.contests.map((row) => [row.name, row.season_year, row.cup_weight])).toEqual([
      ['Majors pool', 2026, 'NORMAL'],
      ['Masters pool', 2026, 'NORMAL'],
      ['NFL season', 2025, 'NORMAL'],
      ['No events', 2024, 'NORMAL'],
    ]);
    expect(result.cups).toEqual([
      { season_year: 2025, sport_league_id: result.nfl },
      { season_year: 2026, sport_league_id: result.pga },
    ]);
    expect(result.scale.cup_points_scale).toBe('STANDARD');
  });
});

/** A league with three squads, a commissioner's membership so cleanup finds it, and a second fixture tour. */
async function seedLeague() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Cup', lastName: `Keeper${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `CUP${suffix.toUpperCase()}`, name: `Cup League ${suffix}` } });
  await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER' } });
  const squad = (name: string) => prisma.squad.create({ data: { leagueId: league.id, name: `${name} ${suffix}`, createdBy: commissioner.user.id } });
  const squads = { eagles: await squad('Eagles'), birdies: await squad('Birdies') };

  /** A contest of `seasonYear` on a fresh edition of the fixture tour, or of `sportLeagueId` when given. */
  const contest = async (name: string, options: {
    seasonYear?: number;
    status?: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED';
    startDate?: string;
    sportLeagueId?: string;
    places?: Array<[squadId: string, position: number | null]>;
  } = {}) => {
    const edition = await freshEventEdition(prisma, { eventYear: options.seasonYear ?? 2026 });
    if (options.sportLeagueId !== undefined) {
      await prisma.eventSeries.update({ where: { id: edition.eventSeriesId }, data: { sportLeagueId: options.sportLeagueId } });
    }
    const event = await prisma.sportEvent.create({
      data: {
        ...edition,
        externalId: `cup-${randomUUID()}`,
        providerId: 'integration-test',
        sport: 'GOLF',
        name: `${name} ${suffix}`,
        startDate: new Date(options.startDate ?? '2026-04-09T12:00:00.000Z'),
      },
    });
    const status = options.status ?? 'COMPLETED';
    const row = await prisma.contest.create({
      data: {
        leagueId: league.id,
        seasonYear: options.seasonYear ?? 2026,
        name,
        status,
        selectionType: 'TIERED',
        endsAt: status === 'COMPLETED' ? new Date('2026-04-12T23:00:00.000Z') : null,
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
      },
    });
    for (const [index, [squadId, position]] of (options.places ?? []).entries()) {
      const entry = await prisma.contestEntry.create({ data: { contestId: row.id, squadId, entryNumber: index + 1, name: `Entry ${index + 1}` } });
      await prisma.contestEntryStanding.create({
        data: { contestId: row.id, contestEntryId: entry.id, position, countingPickLimit: 4, scoredPickCount: 4, settledAt: new Date() },
      });
    }
    return { contest: row, sportLeagueId: options.sportLeagueId ?? (await prisma.eventSeries.findUniqueOrThrow({ where: { id: edition.eventSeriesId } })).sportLeagueId };
  };
  return { league, squads, contest };
}

describe('PrismaCupRepository (#841)', () => {
  it('makes one cup per league, season and sports league, returning the same cup when asked again', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { league, contest } = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const key = { leagueId: league.id, seasonYear: 2026, sportLeagueId };

    const first = await repo.ensure(key);
    const again = await repo.ensure(key);
    await repo.ensure({ ...key, seasonYear: 2027 });

    expect(again.id).toBe(first.id);
    expect((await repo.findByLeagueSeason(league.id, 2026)).map((cup) => cup.id)).toEqual([first.id]);
    await expect(repo.findById(first.id)).resolves.toMatchObject(key);
  });

  it('finds the league\'s cup by season and sports league, and null for a season or league with none (#1202)', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { league, contest } = await seedLeague();
    const other = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const key = { leagueId: league.id, seasonYear: 2026, sportLeagueId };
    const cup = await repo.ensure(key);
    await repo.ensure({ ...key, seasonYear: 2027 });

    await expect(repo.findByKey(key)).resolves.toMatchObject({ id: cup.id, ...key });
    await expect(repo.findByKey({ ...key, seasonYear: 2025 })).resolves.toBeNull();
    await expect(repo.findByKey({ ...key, leagueId: other.league.id })).resolves.toBeNull();
  });

  it('reads the cup\'s season and sports league contests by first event start, leaving out drafts, other seasons and other sports leagues', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(prisma);
    const { league, contest } = await seedLeague();
    const { sportLeagueId } = await contest('Open', { startDate: '2026-06-18T12:00:00.000Z', status: 'ACTIVE' });
    await contest('Masters', { startDate: '2026-04-09T12:00:00.000Z' });
    await contest('Draft', { status: 'DRAFT' });
    await contest('Last season', { seasonYear: 2025 });
    const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: 'GOLF' } });
    const otherTour = await prisma.sportLeague.upsert({
      where: { sportId_name: { sportId: sport.id, name: 'Fixture Tour B (cups)' } },
      create: { sportId: sport.id, name: 'Fixture Tour B (cups)' },
      update: {},
    });
    await contest('Other tour', { sportLeagueId: otherTour.id });

    const contests = await repo.findContests({ leagueId: league.id, seasonYear: 2026, sportLeagueId });

    expect(contests.map((row) => [row.name, row.status, row.cupWeight, row.completedAt?.toISOString() ?? null])).toEqual([
      ['Masters', 'COMPLETED', 'NORMAL', '2026-04-12T23:00:00.000Z'],
      ['Open', 'ACTIVE', 'NORMAL', null],
    ]);
  });

  it('reads every contest of the league\'s cups with its season and sports league by first event start, leaving out drafts, or one season\'s alone (#1166)', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(prisma);
    const { league, contest } = await seedLeague();
    const { sportLeagueId } = await contest('Open', { startDate: '2026-06-18T12:00:00.000Z', status: 'ACTIVE' });
    await contest('Masters', { startDate: '2026-04-09T12:00:00.000Z' });
    await contest('Draft', { status: 'DRAFT' });
    await contest('Last season', { seasonYear: 2025, startDate: '2025-04-10T12:00:00.000Z' });
    const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: 'GOLF' } });
    const otherTour = await prisma.sportLeague.upsert({
      where: { sportId_name: { sportId: sport.id, name: 'Fixture Tour B (cups)' } },
      create: { sportId: sport.id, name: 'Fixture Tour B (cups)' },
      update: {},
    });
    await contest('Other tour', { sportLeagueId: otherTour.id, startDate: '2026-05-01T12:00:00.000Z' });

    const all = await repo.findLeagueContests(league.id);
    const season = await repo.findLeagueContests(league.id, 2026);

    expect(all.map((row) => [row.contest.name, row.seasonYear, row.sportLeagueId === sportLeagueId ? 'tour' : 'other', row.contest.completedAt?.toISOString() ?? null])).toEqual([
      ['Last season', 2025, 'tour', '2026-04-12T23:00:00.000Z'],
      ['Masters', 2026, 'tour', '2026-04-12T23:00:00.000Z'],
      ['Other tour', 2026, 'other', '2026-04-12T23:00:00.000Z'],
      ['Open', 2026, 'tour', null],
    ]);
    expect(season.map((row) => row.contest.name)).toEqual(['Masters', 'Other tour', 'Open']);
    expect(season.find((row) => row.contest.name === 'Masters')?.contest).toEqual(
      (await repo.findContests({ leagueId: league.id, seasonYear: 2026, sportLeagueId })).find((row) => row.name === 'Masters'),
    );
  });

  it('reads every cup of the league, of every season, oldest first, and no other league\'s (#1166)', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { league, contest } = await seedLeague();
    const other = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const first = await repo.ensure({ leagueId: league.id, seasonYear: 2025, sportLeagueId });
    const second = await repo.ensure({ leagueId: league.id, seasonYear: 2026, sportLeagueId });
    await repo.ensure({ leagueId: other.league.id, seasonYear: 2026, sportLeagueId });

    await expect(repo.findByLeague(league.id)).resolves.toMatchObject([{ id: first.id, seasonYear: 2025 }, { id: second.id, seasonYear: 2026 }]);
  });

  it('reads the seasons the league has a listed contest in, newest first and each once, leaving out a season with only a draft', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { league, contest } = await seedLeague();
    await contest('Masters');
    await contest('Open', { status: 'ACTIVE' });
    await contest('Last season', { seasonYear: 2025 });
    await contest('Next season draft', { seasonYear: 2027, status: 'DRAFT' });

    await expect(repo.findSeasonYears(league.id)).resolves.toEqual([2026, 2025]);
  });

  it('reads every entry with a frozen place, with its squad, and none without one', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { squads, contest } = await seedLeague();
    const { contest: masters } = await contest('Masters', { places: [[squads.eagles.id, 1], [squads.birdies.id, 2], [squads.birdies.id, null]] });

    const entries = await repo.findRankedEntries([masters.id]);

    expect(entries.map((entry) => [entry.squadId, entry.position]).sort((left, right) => Number(left[1]) - Number(right[1]))).toEqual([
      [squads.eagles.id, 1],
      [squads.birdies.id, 2],
    ]);
    await expect(repo.findRankedEntries([])).resolves.toEqual([]);
  });

  it('reads a league\'s points table, STANDARD by default, and refuses custom points on any other table', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(prisma);
    const { league } = await seedLeague();

    await expect(repo.findPointsTable(league.id)).resolves.toEqual({ scale: CupPointsScale.STANDARD, customPoints: [] });
    await expect(prisma.league.update({ where: { id: league.id }, data: { cupCustomPoints: [10, 5] } })).rejects.toThrow();
    await expect(prisma.league.update({ where: { id: league.id }, data: { cupPointsScale: 'CUSTOM' } })).rejects.toThrow();

    await prisma.league.update({ where: { id: league.id }, data: { cupPointsScale: 'CUSTOM', cupCustomPoints: [10, 5] } });
    await expect(repo.findPointsTable(league.id)).resolves.toEqual({ scale: CupPointsScale.CUSTOM, customPoints: [10, 5] });
    await expect(repo.findPointsTable(randomUUID())).resolves.toBeNull();
  });

  it('reads each squad\'s settled finish in the contests, with the weight it was settled at and when it was written', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(prisma);
    const { league, squads, contest } = await seedLeague();
    const { contest: masters } = await contest('Masters');
    const settledAt = new Date('2026-04-12T23:00:00.000Z');
    await prisma.leagueYearFinish.createMany({
      data: [
        { leagueId: league.id, year: 2026, squadId: squads.eagles.id, contestId: masters.id, place: 1, tiedCount: 1, rankedEntryCount: 3, weight: 'BONUS', points: 1500, settledAt },
        { leagueId: league.id, year: 2026, squadId: squads.birdies.id, contestId: masters.id, place: 2, tiedCount: 2, rankedEntryCount: 3, weight: 'BONUS', points: 1088, settledAt },
      ],
    });

    const finishes = await repo.findFinishes([masters.id]);

    expect(finishes.map(({ recordedAt, ...finish }) => ({ ...finish, recorded: recordedAt instanceof Date })).sort((left, right) => left.place - right.place)).toEqual([
      { contestId: masters.id, squadId: squads.eagles.id, place: 1, tiedCount: 1, rankedEntryCount: 3, weight: CupWeight.BONUS, recorded: true },
      { contestId: masters.id, squadId: squads.birdies.id, place: 2, tiedCount: 2, rankedEntryCount: 3, weight: CupWeight.BONUS, recorded: true },
    ]);
    await expect(repo.findFinishes([])).resolves.toEqual([]);
  });

  it('crowns an open cup once, freezing its standings and points table, and refuses a crowned cup without a crowning date', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(prisma);
    const { league, squads, contest } = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const cup = await repo.ensure({ leagueId: league.id, seasonYear: 2026, sportLeagueId });
    const crownedAt = new Date('2026-09-30T12:00:00.000Z');
    const standing = (squadId: string, position: number, points: number, trophy: CupTrophy | null) => ({
      cupId: cup.id, squadId, position, displayPosition: String(position), points, wins: position === 1 ? 1 : 0, podiums: 1, contestsCounted: 1, trophy,
    });
    const standings = [standing(squads.eagles.id, 1, 1000, CupTrophy.CHAMPION), standing(squads.birdies.id, 2, 800, CupTrophy.RUNNER_UP)];
    const table = { scale: CupPointsScale.CUSTOM, customPoints: [10, 5] };

    expect(cup).toMatchObject({ status: CupStatus.OPEN, crownedAt: null, crownedPointsTable: null });
    await expect(repo.findStandings([cup.id])).resolves.toEqual([]);
    await expect(prisma.cup.update({ where: { id: cup.id }, data: { status: 'CROWNED' } })).rejects.toThrow();

    const crowned = await repo.crown(cup.id, { crownedAt, pointsTable: table, standings });
    const again = await repo.crown(cup.id, { crownedAt, pointsTable: table, standings });

    expect(crowned).toMatchObject({ id: cup.id, status: CupStatus.CROWNED, crownedAt, crownedPointsTable: table });
    expect(again).toBeNull();
    await expect(repo.findById(cup.id)).resolves.toMatchObject({ status: CupStatus.CROWNED, crownedPointsTable: table });
    await expect(repo.findStandings([cup.id])).resolves.toEqual(standings);
    await expect(repo.findStandings([])).resolves.toEqual([]);
  });

  it('reads several crowned cups\' frozen standings in one read, by cup and position (#1166)', async () => {
    const repo = new PrismaCupRepository(getPrisma());
    const { league, squads, contest } = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const crownedAt = new Date('2026-09-30T12:00:00.000Z');
    const table = { scale: CupPointsScale.STANDARD, customPoints: [] };
    const cups = [
      await repo.ensure({ leagueId: league.id, seasonYear: 2024, sportLeagueId }),
      await repo.ensure({ leagueId: league.id, seasonYear: 2025, sportLeagueId }),
      await repo.ensure({ leagueId: league.id, seasonYear: 2026, sportLeagueId }),
    ];
    const standing = (cupId: string, squadId: string, position: number) => ({
      cupId, squadId, position, displayPosition: String(position), points: 1000 - position * 100, wins: 0, podiums: 1, contestsCounted: 1, trophy: null,
    });
    for (const cup of cups.slice(0, 2)) {
      await repo.crown(cup.id, { crownedAt, pointsTable: table, standings: [standing(cup.id, squads.birdies.id, 2), standing(cup.id, squads.eagles.id, 1)] });
    }

    const rows = await repo.findStandings(cups.map((cup) => cup.id));

    const expected = cups.slice(0, 2).flatMap((cup) => [[cup.id, squads.eagles.id, 1], [cup.id, squads.birdies.id, 2]]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(rows.map((row) => [row.cupId, row.squadId, row.position])).toEqual(expected);
  });
});
