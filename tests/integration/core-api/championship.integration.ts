/**
 * The league championship against Postgres (#863): the queries the championship reads.
 */
import { randomUUID } from 'node:crypto';
import { CupWeight, SelectionType } from '@poolmaster/shared/domain';
import { expectDefined } from '../../support/expect-defined';
import { PrismaChampionshipRepository, PrismaLeagueYearReviewRepository } from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
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
    const repo = new PrismaChampionshipRepository(getAppPrisma());
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

  it('answers whether the league has a counted finish in a year: not for a year of only NOT_COUNTED finishes, nor another league\'s (#1166)', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, squads, contest } = await seedLeague();
    const other = await seedLeague();
    const counted = await contest('Counted');
    const notCounted = await contest('Not counted', { cupWeight: 'NOT_COUNTED' });
    const finish = (leagueId: string, squadId: string, contestId: string, year: number, weight: CupWeight) => ({
      leagueId, year, squadId, contestId, place: 1, tiedCount: 1, rankedEntryCount: 2, weight, points: weight === CupWeight.NOT_COUNTED ? 0 : 1000, settledAt: new Date(`${String(year)}-06-01T00:00:00.000Z`),
    });
    await repo.recordFinishes([
      finish(league.id, squads.eagles.id, counted.id, 2025, CupWeight.NORMAL),
      finish(league.id, squads.eagles.id, notCounted.id, 2024, CupWeight.NOT_COUNTED),
    ]);

    await expect(Promise.all([
      repo.hasCountedFinish(league.id, 2025),
      repo.hasCountedFinish(league.id, 2024),
      repo.hasCountedFinish(league.id, 2026),
      repo.hasCountedFinish(other.league.id, 2025),
    ])).resolves.toEqual([true, false, false, false]);
  });

  it('counts the league\'s open and live contests that will count, not drafts, finals or NOT_COUNTED ones', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    await contest('Open', { status: 'OPEN' });
    await contest('Live', { status: 'ACTIVE' });
    await contest('Draft', { status: 'DRAFT' });
    await contest('Final', { status: 'COMPLETED' });
    await contest('Fun', { status: 'ACTIVE', cupWeight: 'NOT_COUNTED' });

    await expect(repo.countUnfinishedContests(league.id)).resolves.toBe(2);
  });

  it('reads the completed contests that went final in a year\'s range, end exclusive, plus those named whenever they ended, each with its sports league (#837)', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
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

  it('reads the completed one-event contests with their series, event year and games counted: how many, over how many rounds, and how many send their winner on (#874, #1166)', async () => {
    const prisma = getPrisma();
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    const masters = await contest('Masters', { cupWeight: 'NOT_COUNTED' });
    const final = await contest('Final');
    const week = await contest('Week');
    await contest('Majors', { events: 2 });
    await contest('Live', { status: 'ACTIVE' });
    const round = (eventId: string, roundNumber: number) => prisma.sportEventRound.create({ data: { sportEventId: eventId, roundNumber, scheduledDate: new Date('2026-04-09T12:00:00.000Z') } });
    const game = (eventId: string, matchNumber: number, roundId: string, advancesToMatchId: string | null = null) => prisma.sportEventMatch.create({
      data: { sportEventId: eventId, sportEventRoundId: roundId, matchNumber, isNeutralSite: true, advancesToMatchId, advancesToSide: advancesToMatchId === null ? null : 'HOME' },
    });
    const finalEventId = expectDefined(final.sportEvents[0]).sportEventId;
    const [semis, decider] = [await round(finalEventId, 1), await round(finalEventId, 2)];
    const last = await game(finalEventId, 3, decider.id);
    await game(finalEventId, 1, semis.id, last.id);
    const weekEventId = expectDefined(week.sportEvents[0]).sportEventId;
    const slate = await round(weekEventId, 1);
    for (const matchNumber of [1, 2, 3]) await game(weekEventId, matchNumber, slate.id);

    const contests = await repo.findSeriesContests(league.id);

    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: expectDefined(masters.sportEvents[0]).sportEvent.eventSeriesId }, select: { name: true, sportLeague: { select: { name: true } } } });
    const names = new Map([[masters.id, 'Masters'], [final.id, 'Final'], [week.id, 'Week']]);
    expect(contests.map((row) => ({ name: names.get(row.id) ?? '', row })).sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, row }) => [name, row.cupWeight, row.eventYear, row.games])).toEqual([
      ['Final', CupWeight.NORMAL, 2026, { count: 2, roundCount: 2, sendingWinnerOn: 1 }],
      ['Masters', CupWeight.NOT_COUNTED, 2026, { count: 0, roundCount: 0, sendingWinnerOn: 0 }],
      ['Week', CupWeight.NORMAL, 2026, { count: 3, roundCount: 1, sendingWinnerOn: 0 }],
    ]);
    expect(contests.find((row) => row.id === masters.id)).toMatchObject({
      eventSeriesId: expectDefined(masters.sportEvents[0]).sportEvent.eventSeriesId,
      seriesName: series.name,
      sportLeagueName: series.sportLeague.name,
      selectionType: SelectionType.TIERED,
    });
    await expect(repo.findSeriesContests(randomUUID())).resolves.toEqual([]);
  });
});

describe('PrismaLeagueYearReviewRepository (#872)', () => {
  it('records a league\'s year in review once and reads it back; a second record for the same year answers null and keeps the first', async () => {
    const repo = new PrismaLeagueYearReviewRepository(getAppPrisma());
    const { league } = await seedLeague();
    const sender = await createTestUser({ firstName: 'Review', lastName: `Sender${randomUUID().slice(0, 8)}` });
    const other = await createTestUser({ firstName: 'Second', lastName: `Press${randomUUID().slice(0, 8)}` });

    expect(await repo.findByLeagueYear(league.id, 2025)).toBeNull();
    const first = await repo.create({ leagueId: league.id, year: 2025, sentByUserId: sender.user.id });
    const again = await repo.create({ leagueId: league.id, year: 2025, sentByUserId: other.user.id });

    expect(first).toMatchObject({ leagueId: league.id, year: 2025, sentByUserId: sender.user.id });
    expect(again).toBeNull();
    expect(await repo.findByLeagueYear(league.id, 2025)).toEqual(first);
    expect(await repo.findByLeagueYear(league.id, 2024)).toBeNull();
  });
});
