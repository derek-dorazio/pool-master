/**
 * Cups against Postgres (#841): the queries cup standings are worked out from.
 */
import { randomUUID } from 'node:crypto';
import { CupPointsScale, CupStatus, CupTrophy, CupWeight, leaguePointsTable } from '@poolmaster/shared/domain';
import { PrismaCupRepository, PrismaLeagueRepository } from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

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
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    const other = await seedLeague();
    const { sportLeagueId } = await contest('Masters');
    const first = await repo.ensure({ leagueId: league.id, seasonYear: 2025, sportLeagueId });
    const second = await repo.ensure({ leagueId: league.id, seasonYear: 2026, sportLeagueId });
    await repo.ensure({ leagueId: other.league.id, seasonYear: 2026, sportLeagueId });

    await expect(repo.findByLeague(league.id)).resolves.toMatchObject([{ id: first.id, seasonYear: 2025 }, { id: second.id, seasonYear: 2026 }]);
  });

  it('reads the seasons the league has a listed contest in, newest first and each once, leaving out a season with only a draft', async () => {
    const repo = new PrismaCupRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    await contest('Masters');
    await contest('Open', { status: 'ACTIVE' });
    await contest('Last season', { seasonYear: 2025 });
    await contest('Next season draft', { seasonYear: 2027, status: 'DRAFT' });

    await expect(repo.findSeasonYears(league.id)).resolves.toEqual([2026, 2025]);
  });

  it('keeps a league\'s points table on its row, STANDARD by default, and refuses custom points on any other table', async () => {
    const prisma = getPrisma();
    const leagues = new PrismaLeagueRepository(getAppPrisma());
    const { league } = await seedLeague();
    const tableOf = async (id: string) => leaguePointsTable(expectDefined(await leagues.findById(id)));

    await expect(tableOf(league.id)).resolves.toEqual({ scale: CupPointsScale.STANDARD, customPoints: [] });
    await expect(prisma.league.update({ where: { id: league.id }, data: { cupCustomPoints: [10, 5] } })).rejects.toThrow();
    await expect(prisma.league.update({ where: { id: league.id }, data: { cupPointsScale: 'CUSTOM' } })).rejects.toThrow();

    await prisma.league.update({ where: { id: league.id }, data: { cupPointsScale: 'CUSTOM', cupCustomPoints: [10, 5] } });
    await expect(tableOf(league.id)).resolves.toEqual({ scale: CupPointsScale.CUSTOM, customPoints: [10, 5] });
  });

  it('reads each squad\'s settled finish in the contests, with the weight it was settled at and when it was written', async () => {
    const prisma = getPrisma();
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
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
    const repo = new PrismaCupRepository(getAppPrisma());
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
