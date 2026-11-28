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
import { fixtureTourSlotId, freshEventEdition, putEventInSlot } from '../../support/event-edition';
import { oneEventSlotId } from '../../support/test-slots';
import { contestOnEvents } from '../../support/contest-rows';

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
  /** A contest of `events` fresh editions of the fixture tour, each in a slot of `slotDefinitionId` when given. */
  const contest = async (name: string, options: { status?: 'OPEN' | 'ACTIVE' | 'COMPLETED' | 'DRAFT'; events?: number; cupWeight?: 'NORMAL' | 'NOT_COUNTED'; endsAt?: Date; slotDefinitionId?: string; championshipYear?: number } = {}) => {
    const editions = [];
    for (let index = 0; index < (options.events ?? 1); index++) {
      const edition = await freshEventEdition(prisma, { championshipYear: options.championshipYear ?? 2026 });
      editions.push(await prisma.sportEvent.create({
        data: {
          ...edition,
          name: `${name} ${index} ${suffix}`,
          startDate: new Date(`${String(options.championshipYear ?? 2026)}-04-09T12:00:00.000Z`),
        },
      }));
    }
    for (const edition of editions) {
      // poolmaster-allow-query-in-loop: a fixture's few events, each put in its slot
      if (options.slotDefinitionId !== undefined) await putEventInSlot(prisma, edition.id, options.slotDefinitionId);
    }
    const sportEventIds = editions.map((event) => event.id);
    const created = await prisma.contest.create({
      data: {
        leagueId: league.id,
        ...(await contestOnEvents(prisma, sportEventIds)),
        name,
        status: options.status ?? 'COMPLETED',
        cupWeight: options.cupWeight ?? 'NORMAL',
        endsAt: options.endsAt ?? null,
        selectionType: 'TIERED',
      },
    });
    return { ...created, sportEventIds };
  };
  return { league, squads, contest };
}

describe('PrismaChampionshipRepository (#863)', () => {
  it('writes a contest\'s finishes once, keeping the first when settlement writes them again, and reads them back by league and year, or only those settled since a moment', async () => {
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
    // Settled at 23:00: kept from that moment, left out after it (#1782).
    await expect(repo.findByLeagueYear(league.id, 2026, new Date('2026-04-12T23:00:00.000Z'))).resolves.toHaveLength(2);
    await expect(repo.findByLeagueYear(league.id, 2026, new Date('2026-04-12T23:00:00.001Z'))).resolves.toEqual([]);
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

  it('counts the league\'s open and live contests that will count by their championship year, not drafts, finals or NOT_COUNTED ones', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    await contest('Open', { status: 'OPEN' });
    await contest('Live', { status: 'ACTIVE' });
    await contest('Draft', { status: 'DRAFT' });
    await contest('Final', { status: 'COMPLETED' });
    await contest('Fun', { status: 'ACTIVE', cupWeight: 'NOT_COUNTED' });

    await expect(repo.countUnfinishedContestsByYear(league.id)).resolves.toEqual(new Map([[2026, 2]]));
  });

  it('reads the completed contests of a championship year however late they went final, or those named, each with its sports league and year (#837, #2021)', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    // Settled with its Season's last event in February, so still the 2025 year's.
    const superBowl = await contest('Super Bowl', { championshipYear: 2025, endsAt: new Date('2026-02-09T04:00:00.000Z') });
    const masters = await contest('Masters', { endsAt: new Date('2026-04-13T22:00:00.000Z') });
    await contest('Live', { championshipYear: 2025, status: 'ACTIVE' });
    const sportLeague = await getPrisma().sportEvent.findUniqueOrThrow({
      where: { id: expectDefined(superBowl.sportEventIds[0]) },
      select: { sportLeague: { select: { name: true } } },
    });

    const contests = await repo.findFinalContests(league.id, { championshipYear: 2025 });

    expect(contests.map((row) => [row.name, row.completedAt?.toISOString() ?? null, row.sportLeagueName, row.selectionType, row.championshipYear])).toEqual([
      ['Super Bowl', '2026-02-09T04:00:00.000Z', sportLeague.sportLeague.name, SelectionType.TIERED, 2025],
    ]);
    await expect(repo.findFinalContests(league.id, { contestIds: [masters.id] })).resolves.toEqual([expect.objectContaining({ name: 'Masters', championshipYear: 2026 })]);
    await expect(repo.findFinalContests(randomUUID(), { championshipYear: 2025 })).resolves.toEqual([]);
  });

  it('reads only the year\'s contests that went final at or after a moment when asked, so League Home\'s recent finals never read the whole year (#2021)', async () => {
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    await contest('Masters', { endsAt: new Date('2026-04-13T22:00:00.000Z') });
    await contest('Week 11', { endsAt: new Date('2026-11-15T05:00:00.000Z') });
    await contest('Undated');

    const recent = await repo.findFinalContests(league.id, { championshipYear: 2026, finishedSince: new Date('2026-11-14T12:00:00.000Z') });

    expect(recent.map((row) => row.name)).toEqual(['Week 11']);
  });

  it('reads the completed one-event contests with their series, event year and games counted: how many, over how many rounds, and how many send their winner on (#874, #1166)', async () => {
    const prisma = getPrisma();
    const repo = new PrismaChampionshipRepository(getAppPrisma());
    const { league, contest } = await seedLeague();
    // The Masters plays the fixture tour's slot (#2010), so its contest is keyed by that definition.
    const definitionId = await fixtureTourSlotId(prisma);
    const masters = await contest('Masters', { cupWeight: 'NOT_COUNTED', slotDefinitionId: definitionId });
    const final = await contest('Final');
    const week = await contest('Week');
    await contest('Majors', { events: 2 });
    await contest('Live', { status: 'ACTIVE' });
    const round = async (eventId: string, roundNumber: number) => prisma.sportEventRound.create({ data: { sportEventId: eventId, sportEventSlotId: await oneEventSlotId(prisma, eventId), roundNumber, scheduledDate: new Date('2026-04-09T12:00:00.000Z') } });
    const game = (eventId: string, matchNumber: number, roundId: string, advancesToMatchId: string | null = null) => prisma.sportEventRoundMatch.create({
      data: { sportEventId: eventId, sportEventRoundId: roundId, matchNumber, advancesToMatchId, advancesToSideNumber: advancesToMatchId === null ? null : 2 },
    });
    const finalEventId = expectDefined(final.sportEventIds[0]);
    const [semis, decider] = [await round(finalEventId, 1), await round(finalEventId, 2)];
    const last = await game(finalEventId, 3, decider.id);
    await game(finalEventId, 1, semis.id, last.id);
    const weekEventId = expectDefined(week.sportEventIds[0]);
    const slate = await round(weekEventId, 1);
    for (const matchNumber of [1, 2, 3]) await game(weekEventId, matchNumber, slate.id);

    const mastersEventId = expectDefined(masters.sportEventIds[0]);

    const contests = await repo.findSeriesContests(league.id);

    const event = await prisma.sportEvent.findUniqueOrThrow({ where: { id: mastersEventId }, select: { name: true, sportLeague: { select: { name: true } } } });
    const names = new Map([[masters.id, 'Masters'], [final.id, 'Final'], [week.id, 'Week']]);
    expect(contests.map((row) => ({ name: names.get(row.id) ?? '', row })).sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, row }) => [name, row.cupWeight, row.championshipYear, row.games])).toEqual([
      ['Final', CupWeight.NORMAL, 2026, { count: 2, roundCount: 2, sendingWinnerOn: 1 }],
      ['Masters', CupWeight.NOT_COUNTED, 2026, { count: 0, roundCount: 0, sendingWinnerOn: 0 }],
      ['Week', CupWeight.NORMAL, 2026, { count: 3, roundCount: 1, sendingWinnerOn: 0 }],
    ]);
    expect(contests.find((row) => row.id === masters.id)).toMatchObject({
      slotDefinitionIds: [definitionId],
      eventName: event.name,
      slotName: null,
      sportLeagueName: event.sportLeague.name,
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
    const first = await repo.create({ leagueId: league.id, championshipYear: 2025, sentByUserId: sender.user.id });
    const again = await repo.create({ leagueId: league.id, championshipYear: 2025, sentByUserId: other.user.id });

    expect(first).toMatchObject({ leagueId: league.id, championshipYear: 2025, sentByUserId: sender.user.id });
    expect(again).toBeNull();
    expect(await repo.findByLeagueYear(league.id, 2025)).toEqual(first);
    expect(await repo.findByLeagueYear(league.id, 2024)).toBeNull();
  });

  it('passes on a failure other than a second press, such as a league that does not exist, instead of answering null', async () => {
    const repo = new PrismaLeagueYearReviewRepository(getAppPrisma());
    const sender = await createTestUser({ firstName: 'Review', lastName: `Orphan${randomUUID().slice(0, 8)}` });

    await expect(repo.create({ leagueId: randomUUID(), championshipYear: 2025, sentByUserId: sender.user.id })).rejects.toThrow(/Foreign key constraint/);
  });
});
